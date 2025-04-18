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
}

export async function getGoogleCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - 1); // Get events from 1 month ago
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
        },
      }
    );

    return response.data.items.map((event: any) => ({
      id: event.id,
      title: event.summary || "No Title",
      start: new Date(event.start.dateTime || event.start.date),
      end: new Date(event.end.dateTime || event.end.date),
      location: event.location,
      description: event.description,
      source: "google" as const,
      allDay: Boolean(event.start.date),
    }));
  } catch (error) {
    console.error("Error fetching Google Calendar events", error);
    return [];
  }
}

export async function getMicrosoftCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
  const startDateTime = new Date();
  startDateTime.setMonth(startDateTime.getMonth() - 1);
  const endDateTime = new Date();
  endDateTime.setMonth(endDateTime.getMonth() + 3);

  try {
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
          $select: "id,subject,start,end,location,bodyPreview,isAllDay",
          $orderby: "start/dateTime",
        },
      }
    );

    return response.data.value.map((event: any) => ({
      id: event.id,
      title: event.subject || "No Title",
      start: new Date(event.start.dateTime + "Z"),
      end: new Date(event.end.dateTime + "Z"),
      location: event.location?.displayName,
      description: event.bodyPreview,
      source: "microsoft" as const,
      allDay: event.isAllDay,
    }));
  } catch (error) {
    console.error("Error fetching Microsoft Calendar events", error);
    return [];
  }
}

export function mergeCalendarEvents(
  googleEvents: CalendarEvent[] = [],
  microsoftEvents: CalendarEvent[] = []
): CalendarEvent[] {
  return [...googleEvents, ...microsoftEvents].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
} 