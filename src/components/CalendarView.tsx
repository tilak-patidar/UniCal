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
  ViewDirective,
  PopupOpenEventArgs,
  QuickInfoTemplatesModel
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

// Check if event is upcoming (within 15 minutes)
const isUpcomingEvent = (startTime: Date): boolean => {
  const now = new Date();
  // Is the event today?
  const isToday = now.toDateString() === startTime.toDateString();
  if (!isToday) return false;
  
  // Calculate time difference in minutes
  const diffInMinutes = (startTime.getTime() - now.getTime()) / (1000 * 60);
  // Return true if event is within the next 15 minutes but hasn't started yet
  return diffInMinutes >= 0 && diffInMinutes <= 15;
};

// Check if event is joinable (upcoming within 15 minutes or ongoing)
export const isJoinableEvent = (startTime: Date, endTime: Date): boolean => {
  const now = new Date();
  // Is the event today?
  const isToday = now.toDateString() === startTime.toDateString();
  if (!isToday) return false;
  
  // Event is joinable if:
  // 1. It's about to start (within next 15 minutes)
  // 2. It's currently ongoing (started but not ended yet)
  const isUpcoming = (startTime.getTime() - now.getTime()) >= 0 && 
                     (startTime.getTime() - now.getTime()) <= 15 * 60 * 1000;
  const isOngoing = now.getTime() >= startTime.getTime() && 
                    now.getTime() <= endTime.getTime();
                    
  return isUpcoming || isOngoing;
};

export default function CalendarView() {
  const { data: session } = useSession();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highlightedEvents, setHighlightedEvents] = useState<CalendarEvent[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const scheduleRef = useRef(null);

  // Update current time every minute to refresh "upcoming" status
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    
    return () => clearInterval(timer);
  }, []);

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

  // Custom event template
  const eventTemplate = (props: any) => {
    const joinable = isJoinableEvent(new Date(props.StartTime), new Date(props.EndTime));
    const hasLink = props.MeetingLink && props.MeetingLink.length > 0;
    
    // Determine if event is upcoming or ongoing
    const now = new Date();
    const startTime = new Date(props.StartTime);
    const isOngoing = now.getTime() >= startTime.getTime();
    
    return (
      <div className="event-wrapper" style={{ padding: '3px 5px', height: '100%', overflow: 'hidden' }}>
        <div className="event-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="event-header" style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'flex-start', 
            marginBottom: '2px' 
          }}>
            <div className="event-title" style={{ 
              fontWeight: 'bold', 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis',
              flex: 1 
            }}>
              {props.Subject}
            </div>
            
            {/* Show join button for joinable events */}
            {joinable && hasLink && (
              <div className="join-button">
                <a 
                  href={props.MeetingLink} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  style={{ 
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    fontSize: '11px',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isOngoing ? (
                    <>
                      <span style={{ marginRight: '3px' }}>🔴</span>
                      Join Now
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: '3px' }}>⚡</span>
                      Join
                    </>
                  )}
                </a>
              </div>
            )}
          </div>
          
          {props.Location && (
            <div className="event-location" style={{ 
              fontSize: '12px', 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis' 
            }}>
              {props.Location}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Custom quick info templates
  const quickInfoTemplates: QuickInfoTemplatesModel = {
    header: (props: any) => {
      return (
        <div className="e-header-icon-wrapper">
          <div className="e-header-icon e-close" title="Close"></div>
          <div className="e-subject e-text-ellipsis" style={{ padding: '5px', fontWeight: 'bold' }} title={props.Subject}>{props.Subject}</div>
        </div>
      );
    },
    content: (props: any) => {
      // Determine if event is ongoing
      const now = new Date();
      const startTime = new Date(props.StartTime);
      const endTime = new Date(props.EndTime);
      const isOngoing = now.getTime() >= startTime.getTime() && now.getTime() <= endTime.getTime();
      
      return (
        <div className="quick-info-content" style={{ padding: '10px' }}>
          <div className="event-time" style={{ marginBottom: '10px', display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: '5px' }}>🕒</span>
            {new Date(props.StartTime).toLocaleString()} - {new Date(props.EndTime).toLocaleString()}
          </div>
          
          {props.Location && (
            <div className="event-location" style={{ marginBottom: '10px', display: 'flex', alignItems: 'center' }}>
              <span style={{ marginRight: '5px' }}>📍</span>
              {props.Location}
            </div>
          )}
          
          {props.Description && (
            <div className="event-description" style={{ marginBottom: '10px' }}>
              <div style={{ fontWeight: '500', marginBottom: '3px' }}>Description:</div>
              <div>{props.Description}</div>
            </div>
          )}
          
          {props.MeetingLink && (
            <div className="meeting-link" style={{ marginTop: '10px' }}>
              <a 
                href={props.MeetingLink} 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ 
                  backgroundColor: isOngoing ? '#d92c2c' : '#0078D4',
                  color: 'white',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontWeight: 'bold'
                }}
              >
                <span style={{ marginRight: '5px' }}>{isOngoing ? '🔴' : '🎥'}</span>
                {isOngoing ? 'Join Now' : 'Join Meeting'}
              </a>
            </div>
          )}
        </div>
      );
    },
    footer: () => <div></div>
  };

  // Handle popup opening
  const onPopupOpen = (args: PopupOpenEventArgs) => {
    if (args.type === 'QuickInfo' && args.data) {
      // Handle any additional popup functionality here if needed
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
              allowMultiple: true,
              template: eventTemplate
            }}
            readonly={true}
            allowResizing={false}
            allowDragAndDrop={false}
            timeScale={{ enable: true, interval: 30, slotCount: 2 }}
            workHours={{ highlight: true, start: '09:00', end: '18:00' }}
            showQuickInfo={true}
            quickInfoTemplates={quickInfoTemplates}
            popupOpen={onPopupOpen}
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