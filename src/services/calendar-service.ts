import axios from "axios";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  source: "google" | "microsoft";
  allDay?: boolean;
  meetingLink?: string;
}

// New interface for creating calendar events
export interface NewCalendarEvent {
  title: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  isOnlineMeeting?: boolean;
  attendees?: string[]; // Email addresses of attendees
  timeZone?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    conferenceSolution?: {
      key?: {
        type?: string;
      };
      name?: string;
    };
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
      label?: string;
    }>;
  };
}

interface MicrosoftCalendarEvent {
  id: string;
  subject?: string;
  start: {
    dateTime: string;
  };
  end: {
    dateTime: string;
  };
  location?: {
    displayName?: string;
  };
  bodyPreview?: string;
  isAllDay?: boolean;
  onlineMeeting?: {
    joinUrl?: string;
  };
  onlineMeetingUrl?: string;
}

export async function getGoogleCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - 2); // Get events from 2 months ago
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + 3); // Get events for the next 3 months

  try {
    const response = await axios.get(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 500, // Increased to 500
          conferenceDataVersion: 1 // Request conference data
        },
      }
    );

    console.log(`Retrieved ${response.data.items?.length || 0} Google events`);
    
    return response.data.items.map((event: GoogleCalendarEvent) => {
      // Extract Zoom meeting link from description or location
      const extractZoomLink = (text?: string): string | undefined => {
        if (!text) return undefined;
        
        // Regular expression to match Zoom meeting URLs
        const zoomRegex = /(https:\/\/[\w-]*\.?zoom\.us\/j\/[^\s"'<>]+)/i;
        const match = text.match(zoomRegex);
        return match ? match[1] : undefined;
      };

      // Check for Zoom meeting link in description or location
      const zoomLink = extractZoomLink(event.description) || extractZoomLink(event.location);
      
      // Get the meeting link - prioritize: 1. Google Meet link, 2. Zoom link, 3. Video entry point
      const meetingLink = event.hangoutLink || 
                          zoomLink ||
                          event.conferenceData?.entryPoints?.find(entryPoint => entryPoint.entryPointType === 'video')?.uri;

      return {
        id: event.id,
        title: event.summary || "No Title",
        start: new Date(event.start.dateTime || event.start.date || ""),
        end: new Date(event.end.dateTime || event.end.date || ""),
        location: event.location,
        description: event.description,
        source: "google" as const,
        allDay: Boolean(event.start.date),
        meetingLink
      };
    });
  } catch (error) {
    console.error("Error fetching Google Calendar events", error);
    return [];
  }
}

export async function getMicrosoftCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
  // Set start date to 2 months ago
  const startDateTime = new Date();
  startDateTime.setMonth(startDateTime.getMonth() - 2);
  startDateTime.setHours(0, 0, 0, 0);
  
  // Set end date to 3 months from now
  const endDateTime = new Date();
  endDateTime.setMonth(endDateTime.getMonth() + 3);

  try {
    console.log("Fetching Microsoft Calendar events with token:", accessToken.substring(0, 10) + "...");
    console.log("Fetching events from", startDateTime.toISOString(), "to", endDateTime.toISOString());
    
    const response = await axios.get(
      "https://graph.microsoft.com/v1.0/me/calendarView",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
        params: {
          startDateTime: startDateTime.toISOString(),
          endDateTime: endDateTime.toISOString(),
          $select: "id,subject,start,end,location,bodyPreview,isAllDay,onlineMeeting,onlineMeetingUrl",
          $orderby: "start/dateTime",
          $top: 500 // Increased to 500
        },
      }
    );

    console.log(`Microsoft response contains ${response.data.value?.length || 0} events`);

    if (!response.data.value || !Array.isArray(response.data.value)) {
      console.error("Invalid Microsoft Calendar response structure", response.data);
      return [];
    }

    // Function to extract Zoom meeting links from text
    const extractZoomLink = (text?: string): string | undefined => {
      if (!text) return undefined;
      
      // Regular expression to match Zoom meeting URLs
      const zoomRegex = /(https:\/\/[\w-]*\.?zoom\.us\/j\/[^\s"'<>]+)/i;
      const match = text.match(zoomRegex);
      return match ? match[1] : undefined;
    };

    const events = response.data.value.map((event: MicrosoftCalendarEvent) => {
      // Convert Microsoft's date format to a JavaScript Date object
      const startDate = new Date(event.start.dateTime + (event.start.dateTime.includes('Z') ? '' : 'Z'));
      const endDate = new Date(event.end.dateTime + (event.end.dateTime.includes('Z') ? '' : 'Z'));
      
      // Check for Zoom meeting link in description or location
      const locationText = event.location?.displayName;
      const zoomLink = extractZoomLink(event.bodyPreview) || extractZoomLink(locationText);
      
      return {
        id: event.id,
        title: event.subject || "No Title",
        start: startDate,
        end: endDate,
        location: event.location?.displayName,
        description: event.bodyPreview,
        source: "microsoft" as const,
        allDay: event.isAllDay,
        meetingLink: event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || zoomLink
      };
    });
    
    console.log(`Processed ${events.length} Microsoft events with date range:`, 
                events.length > 0 ? 
                `${events[0].start.toISOString()} to ${events[events.length-1].end.toISOString()}` : 
                "No events");
                
    return events;
  } catch (error) {
    console.error("Error fetching Microsoft Calendar events", error);
    if (axios.isAxiosError(error)) {
      console.error("Microsoft API Error Response:", error.response?.data);
    }
    return [];
  }
}

export function mergeCalendarEvents(
  googleEvents: CalendarEvent[] = [],
  microsoftEvents: CalendarEvent[] = []
): CalendarEvent[] {
  console.log(`Merging ${googleEvents.length} Google events and ${microsoftEvents.length} Microsoft events`);
  return [...googleEvents, ...microsoftEvents].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}

export async function createGoogleCalendarEvent(accessToken: string, event: NewCalendarEvent): Promise<CalendarEvent | null> {
  try {
    // Format attendees as Google expects
    const attendees = event.attendees?.map(email => ({ email })) || [];
    
    // Create the request body
    const requestBody = {
      summary: event.title,
      location: event.location,
      description: event.description,
      start: {
        dateTime: event.start.toISOString(),
        timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: event.end.toISOString(),
        timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      attendees,
      // Add video conferencing if requested
      conferenceData: event.isOnlineMeeting ? {
        createRequest: {
          requestId: `${Date.now()}`
        }
      } : undefined
    };

    // Make the API call
    const response = await axios.post(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          conferenceDataVersion: event.isOnlineMeeting ? 1 : 0
        }
      }
    );

    // Extract Zoom meeting link from description or location
    const extractZoomLink = (text?: string): string | undefined => {
      if (!text) return undefined;
      
      // Regular expression to match Zoom meeting URLs
      const zoomRegex = /(https:\/\/[\w-]*\.?zoom\.us\/j\/[^\s"'<>]+)/i;
      const match = text.match(zoomRegex);
      return match ? match[1] : undefined;
    };

    // Check for Zoom meeting link in description or location
    const zoomLink = extractZoomLink(response.data.description) || extractZoomLink(response.data.location);
    
    // Convert to our CalendarEvent format
    return {
      id: response.data.id,
      title: response.data.summary || "No Title",
      start: new Date(response.data.start.dateTime || response.data.start.date),
      end: new Date(response.data.end.dateTime || response.data.end.date),
      location: response.data.location,
      description: response.data.description,
      source: "google" as const,
      allDay: Boolean(response.data.start.date),
      meetingLink: response.data.hangoutLink || 
                   zoomLink ||
                   response.data.conferenceData?.entryPoints?.find(
                     (entryPoint: any) => entryPoint.entryPointType === 'video'
                   )?.uri
    };
  } catch (error) {
    console.error("Error creating Google Calendar event", error);
    if (axios.isAxiosError(error)) {
      console.error("Google API Error Response:", error.response?.data);
    }
    return null;
  }
}

export async function createMicrosoftCalendarEvent(accessToken: string, event: NewCalendarEvent): Promise<CalendarEvent | null> {
  try {
    // Format attendees as Microsoft expects
    const attendees = event.attendees?.map(email => ({
      emailAddress: {
        address: email
      },
      type: "required"
    })) || [];

    // Create the request body
    const requestBody = {
      subject: event.title,
      body: {
        contentType: "HTML",
        content: event.description || ""
      },
      start: {
        dateTime: event.start.toISOString(),
        timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: event.end.toISOString(),
        timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      location: {
        displayName: event.location || ""
      },
      attendees,
      isOnlineMeeting: event.isOnlineMeeting,
      onlineMeetingProvider: event.isOnlineMeeting ? "teamsForBusiness" : null
    };

    // Make the API call
    const response = await axios.post(
      "https://graph.microsoft.com/v1.0/me/events",
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Function to extract Zoom meeting links from text
    const extractZoomLink = (text?: string): string | undefined => {
      if (!text) return undefined;
      
      // Regular expression to match Zoom meeting URLs
      const zoomRegex = /(https:\/\/[\w-]*\.?zoom\.us\/j\/[^\s"'<>]+)/i;
      const match = text.match(zoomRegex);
      return match ? match[1] : undefined;
    };

    // Check for Zoom meeting link in description or location
    const locationText = response.data.location?.displayName;
    const zoomLink = extractZoomLink(response.data.bodyPreview) || extractZoomLink(locationText);

    // Convert to our CalendarEvent format
    return {
      id: response.data.id,
      title: response.data.subject || "No Title",
      start: new Date(response.data.start.dateTime + (response.data.start.dateTime.includes('Z') ? '' : 'Z')),
      end: new Date(response.data.end.dateTime + (response.data.end.dateTime.includes('Z') ? '' : 'Z')),
      location: response.data.location?.displayName,
      description: response.data.bodyPreview,
      source: "microsoft" as const,
      allDay: response.data.isAllDay,
      meetingLink: response.data.onlineMeeting?.joinUrl || response.data.onlineMeetingUrl || zoomLink
    };
  } catch (error) {
    console.error("Error creating Microsoft Calendar event", error);
    if (axios.isAxiosError(error)) {
      console.error("Microsoft API Error Response:", error.response?.data);
    }
    return null;
  }
}

// Function to create a calendar event on the appropriate platform
export async function createCalendarEvent(
  provider: string, 
  accessToken: string, 
  event: NewCalendarEvent
): Promise<CalendarEvent | null> {
  if (provider === "google") {
    return createGoogleCalendarEvent(accessToken, event);
  } else if (provider === "azure-ad") {
    return createMicrosoftCalendarEvent(accessToken, event);
  } else {
    console.error(`Unsupported provider: ${provider}`);
    return null;
  }
}