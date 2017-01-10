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
	
	// Max value lookup map to speed up GetMaxSampleValue
	std::vector<uint32_t> maxValueLookup = {
		(1U << 7) - 1,
		(1U << 15) - 1,
		(1U << 23) - 1,
		(1U << 31) - 1
	};

	double MixSample(double a, double b) {
		return (1.0 - fabs(a * b)) * (a + b);
	}
	
	uint32_t GetMaxSampleValue(unsigned int byteSize) {
		return maxValueLookup[byteSize - 1];
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
		// unsigned int sampleSize = bitdepth / 8 * channels;
		unsigned int byteSize = bitdepth / 8;
		
		if (bitdepth % 8 != 0) {
			Nan::ThrowError("Bit depth must be a multiple of 8!");
			return;
		}
		
		char* outputBuffer = new (std::nothrow) char[length];
		
		if (outputBuffer == nullptr) {
			Nan::ThrowError("Memory allocation failed!");
			return;
		}
		
		Nan::MaybeLocal<Object> output = Nan::NewBuffer(outputBuffer, length);
		/* Local<String> transitionLengthSymbol = Nan::New("transitionLength").ToLocalChecked();
		Local<String> transitionCurrentSymbol = Nan::New("transitionCurrent").ToLocalChecked();
		Local<String> volumeSymbol = Nan::New("volume").ToLocalChecked(); */
		
		for (uint32_t offset = 0; offset < length; offset += byteSize){
			double value = 0.0;
			for (uint32_t i = 0; i < bufArray->Length(); i++) {
				Local<Object> src = Local<Object>::Cast(srcArray->Get(i));
				Local<Object> buf = Local<Object>::Cast(bufArray->Get(i));
				/* int64_t transitionLength = src->Get(transitionLengthSymbol)->IntegerValue();
				int64_t transitionCurrent = src->Get(transitionCurrentSymbol)->IntegerValue();
				double transitionFrom = src->Get(Nan::New("transitionFrom").ToLocalChecked())->NumberValue();
				double transitionTo = src->Get(Nan::New("transitionTo").ToLocalChecked())->NumberValue(); */
				
				double volume = 1.0;
				
				// Process fading
				/* if (offset % sampleSize == 0 && transitionLength >= 0) {
					transitionCurrent++;
					volume = transitionFrom + (transitionTo - transitionFrom) * ((double)transitionCurrent / (double)transitionLength);
					
					if (transitionCurrent >= transitionLength) {
						volume = transitionTo;
						transitionLength = -1;
					}
				} */
				
				char* buffer = node::Buffer::Data(buf);
				
				double sample = ReadSample(buffer + offset, byteSize) * volume;
				value = MixSample(value, sample);
				
				/* src->Set(transitionLengthSymbol, Nan::New<Number>(transitionLength));
				src->Set(transitionCurrentSymbol, Nan::New<Number>(transitionCurrent));
				src->Set(volumeSymbol, Nan::New<Number>(volume)); */
			}
			
			// Write the new mixed sample
			WriteSample(outputBuffer, value, byteSize);
			outputBuffer += byteSize;
		}
		
		args.GetReturnValue().Set(output.ToLocalChecked());
	}
	
	void Init(Local<Object> exports, Local<Object> module) {
		Nan::SetMethod(module, "exports", Mix);
	}
	
	NODE_MODULE(mix, Init)
}