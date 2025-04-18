"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import Header from "@/components/Header";

// Dynamically import the CalendarView component to avoid SSR issues with react-big-calendar
const CalendarView = dynamic(() => import("@/components/CalendarView"), {
  ssr: false,
  loading: () => <p className="flex items-center justify-center h-[80vh]">Loading calendar...</p>
});

export default function Home() {
  const { status } = useSession();

  // If not authenticated, redirect to sign-in page
  if (status === "unauthenticated") {
    redirect("/auth/signin");
  }

  return (
    <div className="flex flex-col h-screen">
      <Header />
      <main className="flex-1 overflow-hidden">
        {status === "loading" ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-lg">Loading...</p>
          </div>
        ) : (
          <CalendarView />
        )}
      </main>
    </div>
  );
}
