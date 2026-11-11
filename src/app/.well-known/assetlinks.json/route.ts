import { NextResponse } from 'next/server'

const ANDROID_PACKAGE_NAME = 'com.layernorm.overlay_mobile'

function getAndroidCertificateFingerprints() {
  return (process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS || '')
    .split(',')
    .map((fingerprint) => fingerprint.trim())
    .filter(Boolean)
}

export async function GET() {
  const fingerprints = getAndroidCertificateFingerprints()

  return NextResponse.json(
    fingerprints.length > 0
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: ANDROID_PACKAGE_NAME,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [],
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/json',
      },
    },
  )
}
