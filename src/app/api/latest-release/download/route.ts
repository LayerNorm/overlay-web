import { logger } from '@/server/observability/logger'
import { NextResponse } from "next/server";
import {
  CACHE_DURATION,
  fetchLatestReleaseInfo,
} from "@/shared/web/latest-release";
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
    const { downloadUrl } = await fetchLatestReleaseInfo();
    const response = NextResponse.redirect(downloadUrl, 307);

    response.headers.set(
      "Cache-Control",
      `public, s-maxage=${CACHE_DURATION}, stale-while-revalidate=86400`
    );

    return response;
  } catch (error) {
    logger.error("Failed to redirect latest release download:", error);
    return NextResponse.json(
      { error: "Failed to fetch latest release download" },
      { status: 500 }
    );
  }
}
