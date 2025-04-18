"use client";

import { useEffect, useState } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { useSession } from "next-auth/react";
import { CalendarEvent, getGoogleCalendarEvents, getMicrosoftCalendarEvents, mergeCalendarEvents } from "@/services/calendar-service";

const locales = {
  'en-US': enUS,
};

// Setup the localizer by providing the date-fns functions
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

const eventStyleGetter = (event: CalendarEvent) => {
  let backgroundColor = "#3174ad"; // Default blue
  
  if (event.source === "google") {
    backgroundColor = "#4285F4"; // Google blue
  } else if (event.source === "microsoft") {
    backgroundColor = "#00a1f1"; // Microsoft blue
  }
  
  return {
    style: {
      backgroundColor,
      borderRadius: "5px",
      opacity: 0.8,
      color: "white",
      border: "0px",
      display: "block",
    },
  };
};

export default function CalendarView() {
  const { data: session } = useSession();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

  useEffect(() => {
    if (!session?.accessToken) return;

    const fetchEvents = async () => {
      setIsLoading(true);
      let googleEvents: CalendarEvent[] = [];
      let microsoftEvents: CalendarEvent[] = [];
      const currentProviders: string[] = [];

      if (session.provider === "google" && session.accessToken) {
        googleEvents = await getGoogleCalendarEvents(session.accessToken);
        currentProviders.push("google");
      } else if (session.provider === "azure-ad" && session.accessToken) {
        microsoftEvents = await getMicrosoftCalendarEvents(session.accessToken);
        currentProviders.push("microsoft");
      }

      setCalendarEvents(mergeCalendarEvents(googleEvents, microsoftEvents));
      setConnectedProviders(currentProviders);
      setIsLoading(false);
    };

    fetchEvents();
  }, [session]);

  return (
    <div className="h-screen p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Unified Calendar</h1>
        <div className="flex space-x-2">
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-[#4285F4] mr-1"></span>
            <span className="text-sm text-gray-600">Google</span>
            <span className="ml-1 text-sm text-gray-400">
              {connectedProviders.includes("google") ? "(Connected)" : "(Not Connected)"}
            </span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full bg-[#00a1f1] mr-1"></span>
            <span className="text-sm text-gray-600">Microsoft</span>
            <span className="ml-1 text-sm text-gray-400">
              {connectedProviders.includes("microsoft") ? "(Connected)" : "(Not Connected)"}
            </span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-lg">Loading your calendar events...</p>
        </div>
      ) : (
        <div className="h-[calc(100vh-120px)]">
          <Calendar
            localizer={localizer}
            events={calendarEvents}
            startAccessor="start"
            endAccessor="end"
            style={{ height: "100%" }}
            eventPropGetter={eventStyleGetter}
            views={["month", "week", "day", "agenda"]}
          />
        </div>
      )}
    </div>
  );
} 