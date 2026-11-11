# Native launch associations

The AASA routes cover mobile Work, agent/DM/chat/room/thread, file/note,
automation, Settings, search, activity, invitation/share and auth paths. Both
The canonical www.getoverlay.io must serve the JSON without redirects. Live
inspection found getoverlay.io returning HTTP 307 to www; native clients claim
only www. Apex support needs an owner hosting change before adding that host.
Apple uses team 562STT95YC and com.layernorm.overlay-mobile. Android uses
com.layernorm.overlay_mobile, matching mobile app.json. assetlinks is domain-wide;
mobile autoVerify intent filters constrain paths.

Set ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS to comma-separated SHA-256
fingerprints from Play app signing and approved internal build certificates.
An empty configuration deliberately returns no Android association. Never place
signing private keys here. Verify signed-device cold/warm link handling after
deployment; local response tests cannot establish Apple/Android trust.
