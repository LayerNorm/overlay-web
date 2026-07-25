/** Official signed DMGs ship as GitHub Releases on the public desktop repo. */
export const GITHUB_REPO = "LayerNorm/overlay-desktop";
export const CACHE_DURATION = 600; // 10 minutes in seconds
export const LATEST_RELEASE_DOWNLOAD_PATH = "/api/latest-release/download";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  assets?: GitHubReleaseAsset[];
}

export interface LatestReleaseInfo {
  version: string;
  downloadUrl: string;
  releaseName: string;
  publishedAt: string;
}

export async function fetchLatestReleaseInfo(): Promise<LatestReleaseInfo> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "overlay-landing",
      },
      next: { revalidate: CACHE_DURATION },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const release = (await response.json()) as GitHubRelease;
  const dmgAsset = release.assets?.find((asset) => asset.name.endsWith(".dmg"));

  if (!dmgAsset) {
    throw new Error("No DMG file found in latest release");
  }

  return {
    version: release.tag_name,
    downloadUrl: dmgAsset.browser_download_url,
    releaseName: release.name,
    publishedAt: release.published_at,
  };
}
