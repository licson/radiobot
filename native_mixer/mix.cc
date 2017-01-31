/*
 * Optimized native function of mixing different buffers
 * This implementation reduces CPU usage and call latency
*/

#include <nan.h>
#include <stdint.h>
#include <cmath>
#include <vector>
#include <new>

namespace NativeMixingOperation {
	using Nan::FunctionCallbackInfo;
	using v8::Local;
	using v8::Handle;
	using v8::Number;
	using v8::Object;
	using v8::Array;
	using v8::String;
	using v8::Function;
	using v8::Value;
	
	struct SourceInfo {
		double volume;
		int64_t transitionLength;
		int64_t transitionCurrent;
		double transitionFrom;
		double transitionTo;
		char* buffer;
	};
	
	// Max value lookup map to speed up GetMaxSampleValue
	std::vector<uint32_t> maxValueLookup = {
		(1U << 7) - 1,
		(1U << 15) - 1,
		(1U << 23) - 1,
		(1U << 31) - 1
	};
	
	// Lookup tables
	const size_t TableSize = 4000;
	std::vector<double> EasingLookup = {};
	std::vector<double> VolumeMapping = {};
	
	double MixSample(double a, double b) {
		return (1.0 - fabs(a * b)) * (a + b);
	}
	
	uint32_t GetMaxSampleValue(unsigned int byteSize) {
		return maxValueLookup[byteSize - 1];
	}
	
	double EasingFunction(double x) {
		return x * x * x;
	}
	
	double Easing(double x, double from, double to) {
		// Do a clamp to prevent out of bounds access (and Segfaults)
		if(x > 1.0) x = 1.0;
		if(x < 0.0) x = 0.0;
		
		uint32_t i = (uint32_t)floor(x * (TableSize - 1));
		return from + EasingLookup[i] * (to - from);
	}
	
	double VolumeFunction(double x) {
		// return exp(6.907 * x) / 1000;
		return pow(10.0, (1.0 - x) * -3);
	}
	
	double Volume(double v) {
		if (v > 1.0) v = 1.0;
		if (v < 0.0) v = 0.0;
		
		uint32_t i = (uint32_t)floor(v * (TableSize - 1));
		return VolumeMapping[i];
	}
	
	double ReadSample(char* p, unsigned int byteSize) {
		double sample = 0.0;
		uint32_t max = GetMaxSampleValue(byteSize);
		int32_t rawValue = 0;
		
		// Assuming signed little-endian for all types
		switch (byteSize) {
			case 1:
				rawValue = !(*p & 0x80) ? (int32_t)*p : (int32_t)((0xff - *p + 1) * -1);
			break;
			
			case 2:
				rawValue = (int32_t)((int16_t)(*p & 0xff | *(p + 1) << 8 & 0xff00));
			break;
			
			case 4:
				rawValue = (int32_t)(
					*p & 0xff |
					*(p + 1) << 8 & 0xff00 |
					*(p + 2) << 16 & 0xff0000 |
					*(p + 3) << 24 & 0xff000000
				);
			break;
		}

		sample = (double)rawValue / (double)max;
		return sample;
	}
	
	void WriteSample(char* p, double value, unsigned int byteSize) {
		if(value > 1.0) value = 1.0;
		if(value < -1.0) value = -1.0;
		
		uint32_t max = GetMaxSampleValue(byteSize);
		int32_t val = 0;
		val = value * max;
		
		// Assuming signed little-endian for all types
		switch (byteSize) {
			case 1:
				*p = val & 0xff;
			break;
			
			case 2:
				*p = val & 0xff;
				*(p + 1) = val >> 8 & 0xff;
			break;
			
			case 4:
				*p = val & 0xff;
				*(p + 1) = val >> 8 & 0xff;
				*(p + 2) = val >> 16 & 0xff;
				*(p + 3) = val >> 24 & 0xff;
			break;
		}
	}

	void Mix(const FunctionCallbackInfo<Value> &args) {
		if (args.Length() < 5) {
			Nan::ThrowError("Usage: mix(buf[], src[], length, bitdepth, channels)");
			return;
		}
		
		if (!args[0]->IsArray()) {
			Nan::ThrowTypeError("Buffers must be an array!");
			return;
		}
		
		if (!args[1]->IsArray()) {
			Nan::ThrowTypeError("Sources must be an array!");
			return;
		}
		
		if (!args[2]->IsNumber()) {
			Nan::ThrowTypeError("Length must be a number!");
			return;
		}
		
		if (!args[3]->IsNumber()) {
			Nan::ThrowTypeError("Bit depth must be a number!");
			return;
		}
		
		if (!args[4]->IsNumber()) {
			Nan::ThrowTypeError("Channels must be a number!");
			return;
		}
		
		Handle<Array> bufArray = Handle<Array>::Cast(args[0]);
		Handle<Array> srcArray = Handle<Array>::Cast(args[1]);
		unsigned int length = args[2]->Uint32Value();
		unsigned int bitdepth = args[3]->Uint32Value();
		unsigned int channels = args[4]->Uint32Value();
		unsigned int sampleSize = bitdepth / 8 * channels;
		unsigned int byteSize = bitdepth / 8;
		
		if (bitdepth % 8 != 0) {
			Nan::ThrowError("Bit depth must be a multiple of 8!");
			return;
		}
		
		if (byteSize > 4 || byteSize == 3) {
			Nan::ThrowError("Unsupported bit depth!");
			return;
		}
		
		char* outputBuffer = new (std::nothrow) char[length];
		
		if (outputBuffer == nullptr) {
			Nan::ThrowError("Memory allocation failed!");
			free(outputBuffer);
			return;
		}
		
		Nan::MaybeLocal<Object> output = Nan::NewBuffer(outputBuffer, length);
		
		std::vector<SourceInfo*> sources;
		
		for (uint32_t i = 0; i < bufArray->Length(); i++) {
			Local<Object> src = Local<Object>::Cast(srcArray->Get(i));
			Local<Object> buf = Local<Object>::Cast(bufArray->Get(i));
			SourceInfo* source = new SourceInfo;
			source->volume = src->Get(Nan::New("volume").ToLocalChecked())->NumberValue();
			source->transitionLength = src->Get(Nan::New("transitionLength").ToLocalChecked())->IntegerValue();
			source->transitionCurrent = src->Get(Nan::New("transitionCurrent").ToLocalChecked())->IntegerValue();
			source->transitionFrom = src->Get(Nan::New("transitionFrom").ToLocalChecked())->NumberValue();
			source->transitionTo = src->Get(Nan::New("transitionTo").ToLocalChecked())->NumberValue();
			source->buffer = node::Buffer::Data(buf);
			sources.push_back(source);
		}
		
		for (uint32_t offset = 0; offset < length; offset += byteSize){
			double value = 0.0;
			for (uint32_t i = 0; i < sources.size(); i++) {
				// Process fading
				if (offset % sampleSize == 0 && sources[i]->transitionLength >= 0) {
					sources[i]->transitionCurrent++;
					sources[i]->volume = Easing(
						(double)(sources[i]->transitionCurrent) / (double)(sources[i]->transitionLength),
						sources[i]->transitionFrom,
						sources[i]->transitionTo
					);
					
					if (sources[i]->transitionCurrent >= sources[i]->transitionLength) {
						sources[i]->volume = sources[i]->transitionTo;
						sources[i]->transitionLength = -1;
					}
				}
				
				char* buffer = sources[i]->buffer;
				double sample = ReadSample(buffer + offset, byteSize) * Volume(sources[i]->volume);
				value = MixSample(value, sample);
			}
			
			// Write the new mixed sample
			WriteSample(outputBuffer, value, byteSize);
			outputBuffer += byteSize;
		}
		
		for (uint32_t i = 0; i < sources.size(); i++) {
			Local<Object> src = Local<Object>::Cast(srcArray->Get(i));
			src->Set(Nan::New("volume").ToLocalChecked(), Nan::New<Number>(sources[i]->volume));
			src->Set(Nan::New("transitionLength").ToLocalChecked(), Nan::New<Number>(sources[i]->transitionLength));
			src->Set(Nan::New("transitionCurrent").ToLocalChecked(), Nan::New<Number>(sources[i]->transitionCurrent));
			src->Set(Nan::New("transitionFrom").ToLocalChecked(), Nan::New<Number>(sources[i]->transitionFrom));
			src->Set(Nan::New("transitionTo").ToLocalChecked(), Nan::New<Number>(sources[i]->transitionTo));
		}
		
		args.GetReturnValue().Set(output.ToLocalChecked());
	}
	
	void Init(Local<Object> exports, Local<Object> module) {
		for (double i = 0; i < TableSize; i++) {
			EasingLookup.push_back(EasingFunction(i / (TableSize - 1)));
			VolumeMapping.push_back(VolumeFunction(i / (TableSize - 1)));
		}
		
		Nan::SetMethod(module, "exports", Mix);
	}
	
	NODE_MODULE(mix, Init)
}