import axios from "axios";
import { CalendarEvent } from "./calendar-service";

export interface AIQueryRequest {
  query: string;
  events: CalendarEvent[];
}

export interface AIQueryResponse {
  answer: string;
  relatedEvents?: CalendarEvent[];
}

/**
 * Process a query about calendar events using the AI API
 */
export async function queryAI(query: string, events: CalendarEvent[]): Promise<AIQueryResponse> {
  try {
    const response = await axios.post('/api/ai/query', {
      query,
      events: events.map(event => ({
        id: event.id,
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        location: event.location,
        description: event.description,
        source: event.source,
        allDay: event.allDay,
        meetingLink: event.meetingLink
      }))
    });
    
    // Convert date strings back to Date objects for any returned events
    if (response.data.relatedEvents && Array.isArray(response.data.relatedEvents)) {
      response.data.relatedEvents = response.data.relatedEvents.map((event: any) => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end)
      }));
    }
    
    return response.data;
  } catch (error) {
    console.error("Error querying AI", error);
    return {
      answer: "Sorry, I couldn't process your query. Please try again."
    };
  }
} 