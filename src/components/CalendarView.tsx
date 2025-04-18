"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { CalendarEvent, getGoogleCalendarEvents, getMicrosoftCalendarEvents, mergeCalendarEvents } from "@/services/calendar-service";
import { ScheduleComponent, Day, Week, WorkWeek, Month, Agenda, Inject, ViewsDirective, ViewDirective } from '@syncfusion/ej2-react-schedule';
import { DateTimePickerComponent } from '@syncfusion/ej2-react-calendars';
import { registerLicense } from '@syncfusion/ej2-base';
// Required CSS imports for Syncfusion
import '@syncfusion/ej2-base/styles/material.css';
import '@syncfusion/ej2-buttons/styles/material.css';
import '@syncfusion/ej2-calendars/styles/material.css';
import '@syncfusion/ej2-dropdowns/styles/material.css';
import '@syncfusion/ej2-inputs/styles/material.css';
import '@syncfusion/ej2-lists/styles/material.css';
import '@syncfusion/ej2-navigations/styles/material.css';
import '@syncfusion/ej2-popups/styles/material.css';
import '@syncfusion/ej2-splitbuttons/styles/material.css';
import '@syncfusion/ej2-react-schedule/styles/material.css';

// Register Syncfusion license
// Get license key from environment variable
registerLicense(process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY || '');

interface StoredAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
}

// Convert CalendarEvent to Syncfusion event data format
const convertToSyncfusionEvents = (events: CalendarEvent[]) => {
  return events.map(event => ({
    Id: event.id,
    Subject: event.title,
    StartTime: event.start,
    EndTime: event.end,
    Location: event.location || '',
    Description: event.description || '',
    IsAllDay: event.allDay || false,
    CategoryColor: event.source === 'google' ? '#4285F4' : '#00a1f1'
  }));
};

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
            const providers = JSON.parse(storedProviders) as string[];
            
            // Add current session provider if it's not already in the list
            if (session.provider && !providers.includes(session.provider)) {
              providers.push(session.provider);
              localStorage.setItem("connectedProviders", JSON.stringify(providers));
            }
            
            setConnectedProviders(providers);
            
            // Check if Microsoft is in the providers list but not the current session
            if (providers.includes("azure-ad") && session.provider !== "azure-ad") {
              const msAccessToken = localStorage.getItem("msAccessToken");
              if (msAccessToken) {
                console.log("Found stored token for Microsoft");
                allTokens.push({
                  provider: "azure-ad",
                  accessToken: msAccessToken,
                  refreshToken: localStorage.getItem("msRefreshToken") || undefined
                });
              } else {
                // For backward compatibility, check the older format
                const storedAccessToken = localStorage.getItem("currentAccessToken");
                const currentProvider = localStorage.getItem("currentProvider");
                if (currentProvider === "azure-ad" && storedAccessToken) {
                  console.log("Found stored token for Microsoft (old format)");
                  allTokens.push({
                    provider: "azure-ad",
                    accessToken: storedAccessToken,
                    refreshToken: localStorage.getItem("currentRefreshToken") || undefined
                  });
                  
                  // Migrate to new format
                  localStorage.setItem("msAccessToken", storedAccessToken);
                  localStorage.setItem("msRefreshToken", localStorage.getItem("currentRefreshToken") || "");
                }
              }
            }
            
            // Check if Google is in the providers list but not the current session
            if (providers.includes("google") && session.provider !== "google") {
              const googleAccessToken = localStorage.getItem("googleAccessToken");
              if (googleAccessToken) {
                console.log("Found stored token for Google");
                allTokens.push({
                  provider: "google",
                  accessToken: googleAccessToken,
                  refreshToken: localStorage.getItem("googleRefreshToken") || undefined
                });
              } else {
                // For backward compatibility, check the older format
                const storedAccessToken = localStorage.getItem("currentAccessToken");
                const currentProvider = localStorage.getItem("currentProvider");
                if (currentProvider === "google" && storedAccessToken) {
                  console.log("Found stored token for Google (old format)");
                  allTokens.push({
                    provider: "google",
                    accessToken: storedAccessToken,
                    refreshToken: localStorage.getItem("currentRefreshToken") || undefined
                  });
                  
                  // Migrate to new format
                  localStorage.setItem("googleAccessToken", storedAccessToken);
                  localStorage.setItem("googleRefreshToken", localStorage.getItem("currentRefreshToken") || "");
                }
              }
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

  // Convert our existing events to Syncfusion format
  const syncfusionEvents = convertToSyncfusionEvents(calendarEvents);

  // Event template to customize appearance based on provider
  const eventTemplate = (props: any) => {
    const sourceColor = props.CategoryColor || '#3174ad';
    
    return (
      <div className="p-1" style={{ backgroundColor: sourceColor, borderRadius: '4px', color: 'white' }}>
        <div className="font-semibold">{props.Subject}</div>
        {props.Location && <div className="text-xs">{props.Location}</div>}
      </div>
    );
  };

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
            <ScheduleComponent 
              height='100%' 
              eventSettings={{ 
                dataSource: syncfusionEvents,
                template: eventTemplate
              }}
              selectedDate={new Date()}
              readonly={true}
            >
              <ViewsDirective>
                <ViewDirective option='Day' />
                <ViewDirective option='Week' />
                <ViewDirective option='WorkWeek' />
                <ViewDirective option='Month' />
                <ViewDirective option='Agenda' />
              </ViewsDirective>
              <Inject services={[Day, Week, WorkWeek, Month, Agenda]} />
            </ScheduleComponent>
          )}
        </div>
      )}
    </div>
  );
} 