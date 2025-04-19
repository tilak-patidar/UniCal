"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { CalendarEvent, getGoogleCalendarEvents, getMicrosoftCalendarEvents, mergeCalendarEvents } from "@/services/calendar-service";
import { 
  ScheduleComponent, 
  Day, 
  Week, 
  WorkWeek, 
  Month, 
  Agenda, 
  Inject, 
  ViewsDirective, 
  ViewDirective
} from '@syncfusion/ej2-react-schedule';
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
import AIAssistant from "./AIAssistant";

// Register Syncfusion license
registerLicense(process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY || '');

interface StoredAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
}

// Convert CalendarEvent to Syncfusion event data format
const convertToSyncfusionEvents = (events: CalendarEvent[]) => {
  return events.map(event => {
    console.log(">>>>>>", event)

    return {
      Id: event.id,
      Subject: event.title,
      StartTime: event.start,
      EndTime: event.end,
      Location: event.location || '',
      Description: event.description || '',
      IsAllDay: event.allDay || false,
      Source: event.source || 'unknown',
      CategoryColor: event.source === 'google' ? '#16a765' : '#0078D4', 
      MeetingLink: event.meetingLink || ''
    };
  });
};

// Color mapping for different sources
const eventColorMapping = {
  'google': '#16a765',   // Google green
  'microsoft': '#0078D4', // Microsoft blue
  'unknown': '#808080'   // Gray for unknown sources
};

export default function CalendarView() {
  const { data: session } = useSession();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highlightedEvents, setHighlightedEvents] = useState<CalendarEvent[]>([]);
  const scheduleRef = useRef(null);

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

  // Highlights specific events when selected by AI
  const handleHighlightEvents = (events: CalendarEvent[]) => {
    setHighlightedEvents(events);
    
    // If we have a schedule reference and events to highlight
    if (scheduleRef.current && events.length > 0) {
      // Find the earliest event to navigate to
      const earliestEvent = [...events].sort((a, b) => 
        a.start.getTime() - b.start.getTime()
      )[0];
      
      // Navigate to the date of the earliest event
      const scheduleObj = (scheduleRef.current as any).scheduleObj;
      if (scheduleObj && earliestEvent) {
        scheduleObj.selectedDate = new Date(earliestEvent.start);
      }
    }
  };

  return (
    <div className="h-full relative">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mx-4 mb-2">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-lg text-gray-600">Loading your calendar...</p>
          </div>
        </div>
      ) : (
        <>
          <ScheduleComponent 
            ref={scheduleRef}
            height='100%' 
            width='100%'
            selectedDate={new Date()}
            eventSettings={{
              dataSource: syncfusionEvents,
              enableTooltip: true,
              allowMultiple: true
            }}
            readonly={true}
            allowResizing={false}
            allowDragAndDrop={false}
            timeScale={{ enable: true, interval: 30, slotCount: 2 }}
            workHours={{ highlight: true, start: '09:00', end: '18:00' }}
            showQuickInfo={true}
            currentView="Week"
            firstDayOfWeek={1}
            eventRendered={(args: any) => {
              if (args.data && args.element) {
                const source = args.data.Source;
                const color = eventColorMapping[source] || eventColorMapping['unknown'];
                args.element.style.backgroundColor = color;
              }
            }}
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
          
          {/* AI Assistant */}
          <AIAssistant 
            events={calendarEvents} 
            onHighlightEvents={handleHighlightEvents} 
          />
        </>
      )}
    </div>
  );
} 