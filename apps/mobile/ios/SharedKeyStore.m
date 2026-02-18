#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SharedKeyStore, NSObject)

RCT_EXTERN_METHOD(setGroqKey:(NSString *)key)
RCT_EXTERN_METHOD(clearGroqKey)

@end
