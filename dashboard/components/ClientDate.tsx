"use client";

import { useEffect, useState } from "react";

interface Props {
  timestamp: number;          // Unix seconds
  format?: "time" | "date" | "datetime";
  className?: string;
}

export function ClientDate({ timestamp, format = "time", className }: Props) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    const d = new Date(timestamp * 1000);
    if (format === "time")     setDisplay(d.toLocaleTimeString());
    else if (format === "date") setDisplay(d.toLocaleDateString());
    else setDisplay(d.toLocaleString());
  }, [timestamp, format]);

  return <span className={className}>{display}</span>;
}
