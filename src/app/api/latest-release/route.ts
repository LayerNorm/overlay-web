import { logger } from '@/server/observability/logger'
import { NextResponse } from "next/server";
import { fetchLatestReleaseInfo } from "@/shared/web/latest-release";
import { areOfficialDesktopDownloadsEnabled } from '@/server/releases/desktop-download-policy'

const DOWNLOADS_FROZEN_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Retry-After': '3600',
} as const

export async function GET() {
  if (!areOfficialDesktopDownloadsEnabled()) {
    return NextResponse.json(
      { error: 'Desktop downloads are temporarily unavailable' },
      { status: 503, headers: DOWNLOADS_FROZEN_HEADERS }
    )
  }

  try {
    const releaseInfo = await fetchLatestReleaseInfo();
    return NextResponse.json(releaseInfo);
  } catch (error) {
    logger.error("Failed to fetch latest release:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest release" },
      { status: 500 }
    );
  }
}
