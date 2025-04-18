"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { CalendarEvent, getGoogleCalendarEvents, getMicrosoftCalendarEvents, mergeCalendarEvents } from "@/services/calendar-service";
import { ScheduleComponent, Day, Week, WorkWeek, Month, Agenda, Inject, ViewsDirective, ViewDirective, PopupOpenEventArgs, QuickInfoTemplatesModel, TimeScaleModel } from '@syncfusion/ej2-react-schedule';
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

// Custom CSS to override Syncfusion styles
const customStyles = `
  /* Base appointment styles */
  .e-schedule .e-appointment {
    background-color: transparent !important;
    border: none !important;
    width: 100% !important;
  }
  
  /* Ensure the appointment content width extends fully */
  .e-schedule .e-appointment-details {
    padding: 0 !important;
    background-color: transparent !important;
    width: 100% !important;
    height: 100% !important;
  }
  
  /* Fix for Day/Week/WorkWeek view - make sure events take proper height */
  .e-schedule .e-vertical-view .e-appointment {
    width: calc(100% - 2px) !important;
    left: 1px !important;
    min-height: 22px !important;
  }
  
  /* Special styling for short events (15min) */
  .e-schedule .e-appointment[data-short-meeting="true"] {
    min-height: 22px !important;
    max-height: 22px !important;
  }
  
  /* Time indicator */
  .e-schedule .e-time-cells {
    color: #666 !important;
    font-size: 12px !important;
    padding-right: 6px !important;
    text-align: right !important;
  }

  /* Remove any borders and shadows */
  .e-schedule .e-appointment {
    box-shadow: none !important;
  }

  /* Event template container styles */
  .event-template-container {
    width: 100% !important;
    height: 100% !important;
    min-height: 22px !important;
    display: flex !important;
    flex-direction: column !important;
  }
  
  /* Short event container styles */
  .short-event-container {
    height: 22px !important;
    min-height: 22px !important;
    max-height: 22px !important;
    overflow: hidden !important;
  }

  /* Remove borders around the entire calendar and its components */
  .e-schedule, .e-schedule .e-schedule-toolbar, .e-schedule .e-schedule-header, 
  .e-schedule .e-timeline-month-view, .e-schedule .e-timeline-view, 
  .e-schedule .e-timeline-year-view, .e-schedule .e-vertical-view,
  .e-schedule .e-month-view, .e-schedule .e-agenda-view {
    border: none !important;
  }

  /* Remove border from schedule cells */
  .e-schedule .e-work-cells, .e-schedule .e-date-header-wrap, 
  .e-schedule .e-work-cells, .e-schedule .e-date-header, 
  .e-schedule .e-timeline-month-cell {
    border-color: #EDEBE9 !important;
  }
  
  /* Style the quick info popup */
  .e-quick-popup-wrapper .e-event-content {
    padding: 10px !important;
  }
  
  /* Make links in popup more visible */
  .e-quick-popup-wrapper .e-event-content a {
    color: #1976d2 !important;
    font-weight: 500 !important;
    text-decoration: none !important;
  }
  
  .e-quick-popup-wrapper .e-event-content a:hover {
    text-decoration: underline !important;
  }
  
  /* Improved meeting link style */
  .e-event-meeting-link {
    margin-top: 8px !important;
    padding: 5px 0 !important;
  }
  
  .e-event-meeting-link a {
    display: flex !important;
    align-items: center !important;
  }
  
  /* Override popup width */
  .e-quick-popup-wrapper {
    max-width: 400px !important;
    width: 100% !important;
  }
`;

interface StoredAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
}

// Convert CalendarEvent to Syncfusion event data format
const convertToSyncfusionEvents = (events: CalendarEvent[]) => {
  return events.map(event => {
    // Calculate duration in milliseconds
    const duration = event.end.getTime() - event.start.getTime();
    
    return {
      Id: event.id,
      Subject: event.title,
      StartTime: event.start,
      EndTime: event.end,
      Location: event.location || '',
      Description: event.description || '',
      IsAllDay: event.allDay || false,
      CategoryColor: event.source === 'google' ? '#4285F4' : '#5b2e91', // Microsoft Teams purple for MS events
      MeetingLink: event.meetingLink || '',
      Duration: duration
    };
  });
};

export default function CalendarView() {
  const { data: session } = useSession();
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scheduleRef = useRef(null);

  useEffect(() => {
    // Add custom styles for Syncfusion scheduler
    const styleElement = document.createElement('style');
    styleElement.textContent = customStyles;
    document.head.appendChild(styleElement);

    return () => {
      // Clean up styles when component unmounts
      document.head.removeChild(styleElement);
    };
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

  // Event template to customize appearance based on provider
  const eventTemplate = (props: {
    Subject: string;
    CategoryColor?: string;
    Location?: string;
    MeetingLink?: string;
    StartTime?: Date;
    EndTime?: Date;
    Duration?: number;
  }) => {
    const sourceColor = props.CategoryColor || '#5b2e91'; // Default to Microsoft Teams purple
    
    // Calculate duration in minutes
    const duration = props.Duration ? props.Duration / (1000 * 60) : 60; // Default to 60 minutes if not provided
    const isShortMeeting = duration <= 15; // 15 minutes or less is considered a short meeting
    
    return (
      <div className={isShortMeeting ? "short-event-container" : "event-template-container"} style={{ 
        backgroundColor: sourceColor, 
        color: 'white', 
        padding: isShortMeeting ? '2px 6px' : '5px 6px',
        width: '100%', 
        height: isShortMeeting ? '22px' : '100%',
        overflow: 'hidden',
        borderRadius: '2px'
      }} data-short-meeting={isShortMeeting}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: isShortMeeting ? 'center' : 'space-between',
          height: '100%'
        }}>
          <div>
            <div style={{ 
              fontWeight: 'bold', 
              fontSize: isShortMeeting ? '12px' : '13px', 
              whiteSpace: 'nowrap', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis' 
            }}>
              {props.Subject}
            </div>
            
            {/* Only show location for meetings longer than 15 minutes */}
            {!isShortMeeting && props.Location && (
              <div style={{ 
                fontSize: '12px', 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                marginTop: '2px'
              }}>
                {props.Location}
              </div>
            )}
          </div>
          
          {/* Only show meeting link for meetings longer than 15 minutes */}
          {!isShortMeeting && props.MeetingLink && (
            <div style={{ fontSize: '12px', marginTop: 'auto', paddingTop: '4px' }}>
              <a 
                href={props.MeetingLink} 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ 
                  color: 'white', 
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.2)',
                  padding: '2px 5px',
                  borderRadius: '3px'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '3px' }}>
                  <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14"></path>
                  <rect x="3" y="6" width="12" height="12" rx="2" ry="2"></rect>
                </svg>
                Join
              </a>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Custom popup template to display meeting links
  const quickInfoTemplates: QuickInfoTemplatesModel = {
    header: (props: any) => {
      return (
        <div className="e-header-icon-wrapper">
          <div className="e-header-icon e-close" title="Close"></div>
          <div className="e-subject e-text-ellipsis" title={props.Subject}>{props.Subject}</div>
        </div>
      );
    },
    content: (props: any) => {
      return (
        <div className="e-event-content">
          <div className="e-event-time flex items-center mt-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {new Date(props.StartTime).toLocaleString()} - {new Date(props.EndTime).toLocaleString()}
          </div>
          
          {props.Location && (
            <div className="e-event-location flex items-center mt-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{props.Location}</span>
            </div>
          )}
          
          {props.Description && (
            <div className="e-event-description mt-2">
              <div className="font-medium">Description:</div>
              <div>{props.Description}</div>
            </div>
          )}
          
          {props.MeetingLink && (
            <div className="e-event-meeting-link flex items-center mt-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <a href={props.MeetingLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Join Meeting
              </a>
            </div>
          )}
        </div>
      );
    },
    footer: () => {
      return <div></div>; // Empty footer
    }
  };

  // Handle popup opening
  const onPopupOpen = (args: PopupOpenEventArgs) => {
    if (args.type === 'QuickInfo' && args.data && !args.data.elementType) {
      // Only proceed for event cells, not empty date cells
      const eventObj = args.data;
      // Can manipulate popup content here if needed
    }
  };

  return (
    <div className="h-screen">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mx-4 mb-2">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-lg">Loading your calendar events...</p>
        </div>
      ) : (
        <div className="h-[calc(100vh-40px)]">
          {calendarEvents.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-lg text-gray-500">No events found in your calendars</p>
            </div>
          ) : (
            <ScheduleComponent 
              ref={scheduleRef}
              height='100%' 
              width='100%'
              cssClass="calendar-custom"
              eventSettings={{ 
                dataSource: syncfusionEvents,
                template: eventTemplate,
                enableMaxHeight: false,
                enableIndicator: false,
                enableTooltip: true
              }}
              selectedDate={new Date()}
              readonly={true}
              allowResizing={false}
              allowDragAndDrop={false}
              quickInfoTemplates={quickInfoTemplates}
              popupOpen={onPopupOpen}
              timeScale={{ enable: true, interval: 30, slotCount: 2 }} // 30-minute increments
              workHours={{ highlight: false }}
              showTimeIndicator={false}
              firstDayOfWeek={1} // Start with Monday
              currentView="Week"
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