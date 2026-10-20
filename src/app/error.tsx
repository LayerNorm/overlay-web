"use client";
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Page Error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] text-[#0a0a0a]">
      <h1 className="text-2xl font-medium mb-2">something went wrong</h1>
      <p className="mb-4 max-w-md break-words px-4 text-center font-mono text-xs text-[#71717a]">
        {error.digest ? `reference ${error.digest}` : error.message}
      </p>
      <Button variant="ghost"
        onClick={reset}
        className={unstyledButton(`px-4 py-2 bg-[#0a0a0a] text-white rounded-full text-sm hover:bg-[#27272a] transition-colors`)}
      >
        try again
      </Button>
    </div>
  );
}
