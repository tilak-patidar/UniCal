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

interface StoredAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
}

export default function CalendarView() {
  const { data: session } = useSession();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.accessToken) return;

    const fetchEvents = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Get stored tokens from localStorage if they exist
        const allTokens: StoredAuthToken[] = [];
        const storedProviders = localStorage.getItem("connectedProviders");
        
        // Add current session to tokens list
        if (session.provider && session.accessToken) {
          allTokens.push({
            provider: session.provider,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken
          });
          
          console.log("Current session provider:", session.provider);
        }
        
        if (storedProviders) {
          try {
            const providers = JSON.parse(storedProviders);
            
            // Add current session provider if it's not already in the list
            if (session.provider && !providers.includes(session.provider)) {
              providers.push(session.provider);
              localStorage.setItem("connectedProviders", JSON.stringify(providers));
            }
            
            setConnectedProviders(providers);
            
            // Check if we have stored tokens for other providers
            const currentProvider = localStorage.getItem("currentProvider");
            const storedAccessToken = localStorage.getItem("currentAccessToken");
            
            if (currentProvider && 
                currentProvider !== session.provider && 
                storedAccessToken && 
                providers.includes(currentProvider)) {
              console.log("Found stored token for:", currentProvider);
              allTokens.push({
                provider: currentProvider,
                accessToken: storedAccessToken,
                refreshToken: localStorage.getItem("currentRefreshToken") || undefined
              });
            }
          } catch (e) {
            console.error("Error parsing stored providers", e);
            setConnectedProviders(session.provider ? [session.provider] : []);
          }
        } else if (session.provider) {
          setConnectedProviders([session.provider]);
          localStorage.setItem("connectedProviders", JSON.stringify([session.provider]));
        }
        
        console.log("Tokens to fetch events:", allTokens.map(t => t.provider));
        
        // Fetch events from all connected providers
        let googleEvents: CalendarEvent[] = [];
        let microsoftEvents: CalendarEvent[] = [];
        
        // Fetch from all tokens
        for (const token of allTokens) {
          if (token.provider === "google" && token.accessToken) {
            console.log("Fetching Google events...");
            const events = await getGoogleCalendarEvents(token.accessToken);
            googleEvents = [...googleEvents, ...events];
            console.log(`Retrieved ${events.length} Google events`);
          } else if (token.provider === "azure-ad" && token.accessToken) {
            console.log("Fetching Microsoft events...");
            const events = await getMicrosoftCalendarEvents(token.accessToken);
            microsoftEvents = [...microsoftEvents, ...events];
            console.log(`Retrieved ${events.length} Microsoft events`);
          }
        }
        
        const mergedEvents = mergeCalendarEvents(googleEvents, microsoftEvents);
        console.log(`Total events after merging: ${mergedEvents.length}`);
        setCalendarEvents(mergedEvents);
      } catch (err) {
        console.error("Error fetching calendar events:", err);
        setError("Failed to load calendar events. Please try again.");
      } finally {
        setIsLoading(false);
      }
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
              {connectedProviders.includes("azure-ad") ? "(Connected)" : "(Not Connected)"}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-lg">Loading your calendar events...</p>
        </div>
      ) : (
        <div className="h-[calc(100vh-120px)]">
          {calendarEvents.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-lg text-gray-500">No events found in your calendars</p>
            </div>
          ) : (
            <Calendar
              localizer={localizer}
              events={calendarEvents}
              startAccessor="start"
              endAccessor="end"
              style={{ height: "100%" }}
              eventPropGetter={eventStyleGetter}
              views={["month", "week", "day", "agenda"]}
            />
          )}
        </div>
      )}
    </div>
  );
} 