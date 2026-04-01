/*
 * Optimized native function of mixing different buffers
 * This implementation reduces CPU usage and call latency
 */

#include <napi.h>
#include <stdint.h>
#include <cmath>
#include <vector>
#include <memory>

struct SourceInfo {
  double volume;
  int64_t transitionLength;
  int64_t transitionCurrent;
  double transitionFrom;
  double transitionTo;
  char* buffer;
};

static const uint32_t maxValues[4] = {
  (1U << 7) - 1,
  (1U << 15) - 1,
  (1U << 23) - 1,
  (1U << 31) - 1
};

static uint32_t GetMaxSampleValue(unsigned int byteSize) {
  return maxValues[byteSize - 1];
}

static const size_t TableSize = 4000;
static std::vector<double> EasingLookup;

static double MixSample(double a, double b) {
  return (1.0 - std::fabs(a * b)) * (a + b);
}

static double EasingFunction(double x) {
  return x * x * x;
}

static double Easing(double x, double from, double to) {
  if (x > 1.0) x = 1.0;
  if (x < 0.0) x = 0.0;
  
  uint32_t i = static_cast<uint32_t>(std::floor(x * (TableSize - 1)));
  return from + EasingLookup[i] * (to - from);
}

static double ReadSample(char* p, unsigned int byteSize) {
  double sample = 0.0;
  uint32_t max = GetMaxSampleValue(byteSize);
  int32_t rawValue = 0;
  
  switch (byteSize) {
    case 1:
      rawValue = !(*p & 0x80) ? static_cast<int32_t>(*p) : static_cast<int32_t>(0xff - *p + 1) * -1;
      break;
      
    case 2:
      rawValue = static_cast<int32_t>(static_cast<int16_t>((*p & 0xff) | (*(p + 1) << 8 & 0xff00)));
      break;
      
    case 3:
      rawValue = static_cast<int32_t>(
        ((*(p + 2) & 0x80) << 24) |
        (*(p + 2) << 16 & 0x7fffff) |
        (*(p + 1) << 8 & 0xffff) |
        (*p & 0xff)
      );
      break;

    case 4:
      rawValue = static_cast<int32_t>(
        (*p & 0xff) |
        (*(p + 1) << 8 & 0xff00) |
        (*(p + 2) << 16 & 0xff0000) |
        (*(p + 3) << 24 & 0xff000000)
      );
      break;
  }

  sample = static_cast<double>(rawValue) / static_cast<double>(max);
  return sample;
}

static void WriteSample(char* p, double value, unsigned int byteSize) {
  if (value > 1.0) value = 1.0;
  if (value < -1.0) value = -1.0;
  
  uint32_t max = GetMaxSampleValue(byteSize);
  int32_t val = static_cast<int32_t>(value * max);
  
  switch (byteSize) {
    case 1:
      *p = val & 0xff;
      break;
      
    case 2:
      *p = val & 0xff;
      *(p + 1) = (val >> 8) & 0xff;
      break;
      
    case 3:
      *p = val & 0xff;
      *(p + 1) = (val >> 8) & 0xff;
      *(p + 2) = ((val >> 16) & 0xff) | (val < 0 ? 0x80 : 0);
      break;

    case 4:
      *p = val & 0xff;
      *(p + 1) = (val >> 8) & 0xff;
      *(p + 2) = (val >> 16) & 0xff;
      *(p + 3) = (val >> 24) & 0xff;
      break;
  }
}

static Napi::Value Mix(const Napi::CallbackInfo& args) {
  Napi::Env env = args.Env();
  
  if (args.Length() < 5) {
    Napi::TypeError::New(env, "Usage: mix(buf[], src[], length, bitdepth, channels)").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  if (!args[0].IsArray()) {
    Napi::TypeError::New(env, "Buffers must be an array!").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  if (!args[1].IsArray()) {
    Napi::TypeError::New(env, "Sources must be an array!").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  if (!args[2].IsNumber()) {
    Napi::TypeError::New(env, "Length must be a number!").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  if (!args[3].IsNumber()) {
    Napi::TypeError::New(env, "Bit depth must be a number!").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  if (!args[4].IsNumber()) {
    Napi::TypeError::New(env, "Channels must be a number!").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  Napi::Array bufArray = args[0].As<Napi::Array>();
  Napi::Array srcArray = args[1].As<Napi::Array>();
  uint32_t length = args[2].As<Napi::Number>().Uint32Value();
  uint32_t bitdepth = args[3].As<Napi::Number>().Uint32Value();
  uint32_t channels = args[4].As<Napi::Number>().Uint32Value();
  uint32_t sampleSize = bitdepth / 8 * channels;
  uint32_t byteSize = bitdepth / 8;
  
  if (bitdepth % 8 != 0) {
    Napi::Error::New(env, "Bit depth must be a multiple of 8!").ThrowAsJavaScriptException();
    return env.Null();
  }
  
  if (byteSize > 4) {
    Napi::Error::New(env, "Unsupported bit depth!").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Buffer<char> output = Napi::Buffer<char>::New(env, length);
  char* outputBuffer = output.Data();

  std::vector<std::unique_ptr<SourceInfo>> sources;

  for (uint32_t i = 0; i < bufArray.Length(); i++) {
    Napi::Object src = srcArray.Get(i).As<Napi::Object>();
    Napi::Buffer<char> buf = bufArray.Get(i).As<Napi::Buffer<char>>();

    auto source = std::make_unique<SourceInfo>();
    source->volume = src.Get("volume").As<Napi::Number>().DoubleValue();
    source->transitionLength = src.Get("transitionLength").As<Napi::Number>().Int64Value();
    source->transitionCurrent = src.Get("transitionCurrent").As<Napi::Number>().Int64Value();
    source->transitionFrom = src.Get("transitionFrom").As<Napi::Number>().DoubleValue();
    source->transitionTo = src.Get("transitionTo").As<Napi::Number>().DoubleValue();
    source->buffer = buf.Data();

    sources.push_back(std::move(source));
  }

  for (uint32_t offset = 0; offset < length; offset += byteSize) {
    double value = 0.0;

    for (size_t i = 0; i < sources.size(); i++) {
      if (offset % sampleSize == 0 && sources[i]->transitionLength >= 0) {
        sources[i]->transitionCurrent++;
        sources[i]->volume = Easing(
          static_cast<double>(sources[i]->transitionCurrent) / static_cast<double>(sources[i]->transitionLength),
          sources[i]->transitionFrom,
          sources[i]->transitionTo
        );
        
        if (sources[i]->transitionCurrent >= sources[i]->transitionLength) {
          sources[i]->volume = sources[i]->transitionTo;
          sources[i]->transitionLength = -1;
        }
      }

      char* buffer = sources[i]->buffer;
      double sample = ReadSample(buffer + offset, byteSize) * sources[i]->volume;
      value = MixSample(value, sample);
    }

    WriteSample(outputBuffer, value, byteSize);
    outputBuffer += byteSize;
  }

  for (uint32_t i = 0; i < sources.size(); i++) {
    Napi::Object src = srcArray.Get(i).As<Napi::Object>();

    src.Set("volume", sources[i]->volume);
    src.Set("transitionLength", sources[i]->transitionLength);
    src.Set("transitionCurrent", sources[i]->transitionCurrent);
    src.Set("transitionFrom", sources[i]->transitionFrom);
    src.Set("transitionTo", sources[i]->transitionTo);
  }

  return output;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  for (double i = 0; i < static_cast<double>(TableSize); i++) {
    EasingLookup.push_back(EasingFunction(i / (TableSize - 1)));
  }

  return Napi::Function::New(env, Mix);
}

NODE_API_MODULE(mixer, Init)
