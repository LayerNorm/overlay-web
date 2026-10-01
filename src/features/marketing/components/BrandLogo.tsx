"use client";

import { useLandingThemeOptional } from "@/contexts/LandingThemeContext";

export function BrandLogo({
  light,
  dark,
  alt = "",
  className,
}: {
  light: string;
  dark?: string;
  alt?: string;
  className?: string;
}) {
  const landing = useLandingThemeOptional();
  const src = landing?.isLandingDark && dark ? dark : light;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

