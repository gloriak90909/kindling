"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { StoredDoc } from "@/lib/idb";

// pdf.js only runs in the browser.
const Library = dynamic(() => import("@/components/Library"), { ssr: false });
const DocumentView = dynamic(() => import("@/components/DocumentView"), { ssr: false });

export default function Home() {
  const [open, setOpen] = useState<StoredDoc | null>(null);
  return open ? <DocumentView doc={open} onBack={() => setOpen(null)} /> : <Library onOpen={setOpen} />;
}
