#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SharedKeyStore, NSObject)

RCT_EXTERN_METHOD(setGroqKey:(NSString *)key)
RCT_EXTERN_METHOD(clearGroqKey)

RCT_EXTERN_METHOD(setAuthSession:(NSString *)token baseURL:(NSString *)baseURL userId:(NSString *)userId)
RCT_EXTERN_METHOD(clearAuthSession)

RCT_EXTERN_METHOD(setBackgroundModeEnabled:(BOOL)enabled
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getBackgroundModeEnabled:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getMicPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestMicPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getTranscriptionHistory:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteTranscription:(NSString *)transcriptionId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
