import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { parse } from 'date-fns';
import Anthropic from '@anthropic-ai/sdk';

interface CalendarEventData {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  source: "google" | "microsoft";
  allDay?: boolean;
  meetingLink?: string;
}

/**
 * API handler for AI queries about calendar events
 */
export async function POST(req: NextRequest) {
  // Verify authentication
  const session = await getServerSession();
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { query, events } = await req.json();
    
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }
    
    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'Events data is required' }, { status: 400 });
    }

    // Process the query using rule-based approach as fallback
    let answer;
    
    // Check if Claude API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        // Use Claude for all responses
        answer = await getClaudeResponse(query, events);
      } catch (error) {
        console.error('Error using Claude API:', error);
        // Fallback to rule-based processing
        answer = await processCalendarQuery(query, events);
      }
    } else {
      // Use rule-based processing if no Claude API key is available
      answer = await processCalendarQuery(query, events);
    }
    
    return NextResponse.json(answer);
  } catch (error) {
    console.error('Error processing AI query:', error);
    return NextResponse.json(
      { answer: 'Sorry, I encountered an error processing your query.' },
      { status: 500 }
    );
  }
}

/**
 * Process user query using Claude AI with optimized prompting for calendar questions
 */
async function getClaudeResponse(query: string, events: CalendarEventData[]) {
  // Preprocess events for better context
  const currentTime = new Date();
  const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
  // Format events for better context
  const enrichedEvents = events.map(event => {
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);
    
    // Calculate duration in minutes
    const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    
    // Format date string for better readability
    const formatDate = (date) => {
      return `${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    };
    
    // Format time string for better readability
    const formatTime = (date) => {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };
    
    // Check if description is empty, undefined or null
    // Make sure to explicitly handle all falsy values including undefined, null, and empty strings
    const hasDescription = Boolean(event.description && typeof event.description === 'string' && event.description.trim() !== '');
    
    return {
      id: event.id,
      title: event.title,
      rawStart: event.start, // Keep original for filtering
      rawEnd: event.end,     // Keep original for filtering
      start: formatDate(startDate),
      startTime: formatTime(startDate),
      endTime: formatTime(endDate),
      timeRange: `from ${formatTime(startDate)} to ${formatTime(endDate)}`,
      duration: hours > 0 ? `${hours}h ${minutes > 0 ? minutes + 'm' : ''}` : `${minutes}m`,
      location: event.location || 'No location specified',
      description: event.description?.substring(0, 150) || 'No description available',
      hasDescription: hasDescription,
      hasAgenda: hasDescription,
      descriptionStatus: hasDescription ? 'Has description/agenda' : 'No description/agenda',
      hasLink: event.meetingLink ? 'Yes' : 'No',
      source: event.source,
      allDay: event.allDay || false,
      startTimestamp: startDate.getTime(), // For sorting
      people: extractPeopleFromTitle(event.title, event.description || '')
    };
  });
  
  // Organize events by date for better context
  const todayStr = currentTime.toISOString().split('T')[0];
  const tomorrowDate = new Date(currentTime);
  tomorrowDate.setDate(currentTime.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0];
  
  // Today's events
  const todayEvents = enrichedEvents.filter(event => 
    event.rawStart.includes(todayStr)
  ).sort((a, b) => a.startTimestamp - b.startTimestamp);
  
  // Tomorrow's events
  const tomorrowEvents = enrichedEvents.filter(event => 
    event.rawStart.includes(tomorrowStr)
  ).sort((a, b) => a.startTimestamp - b.startTimestamp);
  
  // Upcoming events
  const upcomingEvents = enrichedEvents
    .filter(event => new Date(event.rawStart) > currentTime)
    .sort((a, b) => a.startTimestamp - b.startTimestamp);
    
  // Get next week's events organized by day
  const nextWeekStart = new Date(currentTime);
  nextWeekStart.setDate(currentTime.getDate() + (7 - currentTime.getDay()));
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 7);
  
  // Organize upcoming events by date for better context
  const eventsByDate = {};
  for (const event of enrichedEvents) {
    const eventDate = new Date(event.rawStart).toISOString().split('T')[0];
    if (!eventsByDate[eventDate]) {
      eventsByDate[eventDate] = [];
    }
    eventsByDate[eventDate].push(event);
  }
  
  // Past events (limited to last 2 weeks)
  const twoWeeksAgo = new Date(currentTime);
  twoWeeksAgo.setDate(currentTime.getDate() - 14);
  const pastEvents = enrichedEvents
    .filter(event => 
      new Date(event.rawStart) < currentTime && 
      new Date(event.rawStart) > twoWeeksAgo
    )
    .sort((a, b) => b.startTimestamp - a.startTimestamp); // Reverse chronological
  
  try {
    // Initialize the Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || ''
    });
    
    // Format current time for reference
    const formattedTime = `${dayNames[currentTime.getDay()]}, ${monthNames[currentTime.getMonth()]} ${currentTime.getDate()}, ${currentTime.getFullYear()} at ${currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    
    // Create an optimized system prompt with examples and guidelines
    const systemPrompt = `You are an expert Calendar Assistant AI that excels at analyzing calendar data and answering questions about meetings, schedules, and availability. You maintain a conversational, helpful tone.

IMPORTANT GUIDELINES:
1. Answer questions with absolute accuracy based ONLY on the calendar data provided
2. Format dates as "Weekday, Month Day" (e.g., "Monday, June 10")
3. Format times in 12-hour format with AM/PM (e.g., "2:30 PM")
4. When listing meetings, ONLY include their title and time by default - keep responses concise
5. For availability/free time questions, analyze gaps between meetings
6. Understand both explicit queries ("meetings today") and implicit ones ("am I busy this afternoon")
7. Never invent meetings or details not present in the data
8. If uncertain, acknowledge limitations rather than guessing
9. Use proper formatting with line breaks between sections and bullet points for lists
10. For "next meeting" queries, find the next chronological meeting after the current time
11. Keep responses focused and concise - users prefer brief listings over detailed descriptions
12. For date-specific queries (e.g., "meetings on Monday", "meetings next week", "meetings on 21/04/2025"), carefully count ALL meetings on that exact date/range
13. Be accurate about date availability - your calendar contains ALL events from the user's calendar - if dates appear in the CALENDAR DATA BY DATE section, those dates have accurate meeting information
14. NEVER claim "I don't have data for that date" or "The calendar only shows dates from X to Y" - the calendar data provided is complete
15. Empty or missing descriptions/details in calendar events should be interpreted as "no agenda" or "no description"
16. When asked about meetings without agendas, look for events with null, undefined, empty, or missing description fields
17. IMPORTANT: If an event has "(No agenda)" beside it, this means it DEFINITELY has no agenda or description
18. Events with no description field, undefined/null descriptions, or empty descriptions ALL count as having "no agenda"
19. When searching for specific meeting types (like "interviews", "1:1s", "standup"), check both the title and description
20. For meeting type searches, look for the keyword in singular, plural, or with variations (interview, interviews, interviewing)

CONVERSATIONAL GUIDELINES:
1. Use a friendly, conversational tone - be personable but professional
2. NEVER start responses with "Based on the calendar data provided" or similar phrases
3. Be extremely concise - deliver answers in as few words as possible
4. For simple questions like "How many meetings today?", provide a direct answer ("You have 3 meetings today.")
5. For availability questions like "Am I free at 3pm?", provide a one-line response ("Yes, you're free at 3pm.")
6. For yes/no questions, start with "Yes" or "No" and keep follow-up explanation minimal
7. Remember previous context in the conversation when appropriate
8. If the user asks a follow-up question, provide the relevant details without restating everything
9. IMPORTANT: Carefully check for overlapping meetings when asked about conflicts/collisions
10. When detecting overlaps, compare actual start/end times, not just if they appear on the same day
11. NEVER explain your reasoning or mention the calendar data in your answers

FORMATTING GUIDELINES:
1. Always use bullet points (•) when listing multiple meetings or events
2. Add line breaks between different sections of your answer
3. Bold important information like meeting titles using ** around the text
4. Use clear section headings when appropriate (Today's Meetings, Tomorrow's Schedule, etc.)
5. Group related information together with proper spacing
6. For time blocks, use consistent formatting "from 9:00 AM to 10:30 AM"
7. Format your responses for maximum readability on mobile and desktop screens
8. Keep location, descriptions, and other details minimal unless specifically requested

EXAMPLES OF PERFECT RESPONSES:

User: "What meetings do I have today?"
Assistant: "You have 3 meetings today. Would you like me to list them?"

User: "Yes, please list them"
Assistant: "Here are your meetings for today:

• **Product Review** from 10:00 AM to 11:00 AM
• **Team Standup** from 1:30 PM to 2:00 PM
• **Client Call** from 4:00 PM to 4:30 PM"

User: "When am I free tomorrow?"
Assistant: "Free times tomorrow: 10:30 AM to 2:00 PM and after 3:00 PM."

User: "Am I available at 4pm?"
Assistant: "Yes, you're available at 4:00 PM."

User: "Am I free tomorrow morning?"
Assistant: "No, you have a meeting from 9:00 AM to 10:30 AM."

User: "What meetings do I have tomorrow?"
Assistant: "You have 2 meetings tomorrow:

• **Morning Sync** from 9:00 AM to 10:30 AM
• **Project Update** from 2:00 PM to 3:00 PM"

User: "Do I have any meetings with Sarah?"
Assistant: "Yes, you have 2 upcoming meetings with Sarah. Should I show you the details?"

User: "Yes please"
Assistant: "Here are your meetings with Sarah:

• **Project Planning** from 11:00 AM to 12:00 PM on Thursday, June 12
• **Budget Review** from 2:00 PM to 3:00 PM on Monday, June 16"

User: "What meetings do I have next Monday?"
Assistant: "You have 3 meetings scheduled for next Monday (April 26):

• **Team Sync** from 9:00 AM to 9:30 AM
• **Product Review** from 1:00 PM to 2:30 PM
• **Weekly Planning** from 4:00 PM to 4:30 PM"

User: "What meetings do I have on April 21?"
Assistant: "You have 2 meetings on Monday, April 21:

• **Team Standup** from 10:00 AM to 10:30 AM
• **Client Presentation** from 2:00 PM to 3:30 PM"

User: "Do any meetings today have no agenda?"
Assistant: "Yes, all 5 meetings today have no agenda:

• **Test join button** from 10:30 AM to 11:00 AM
• **Test meeting to create** from 11:15 AM to 11:45 AM
• **Testing meeting creation** from 11:18 AM to 1:00 PM
• **Testing meeting creation** from 11:18 AM to 1:00 PM
• **New meeting** from 4:00 PM to 5:00 PM"

User: "How many meetings today?"
Assistant: "You have 4 meetings today. Would you like to see them?"

User: "Yes"
Assistant: "Here they are:

• **Weekly Sync** from 9:00 AM to 9:30 AM
• **Client Check-in** from 11:00 AM to 11:30 AM
• **Team Lunch** from 12:00 PM to 1:00 PM
• **Project Review** from 3:00 PM to 4:00 PM"

User: "How many interviews do I have next week?"
Assistant: "You have 2 interviews next week:

• **Interview with John** on Monday from 2:00 PM to 3:00 PM
• **Technical Interview** on Wednesday from 11:00 AM to 12:00 PM"

User: "Do I have any overlapping meetings today?"
Assistant: "Yes, you have 2 overlapping meetings today:

• **Team Meeting** from 11:15 AM to 12:15 PM
• **Project Demo** from 11:30 AM to 12:30 PM

These meetings overlap between 11:30 AM and 12:15 PM."`;

    // Prepare user message with structured calendar data
    // First, let's ensure our date data is accurate
    const calendarDateMap = {};
    
    // Process each event to organize by date with the actual event data
    events.forEach(event => {
      const eventDate = new Date(event.start);
      const dateKey = eventDate.toISOString().split('T')[0];
      
      if (!calendarDateMap[dateKey]) {
        calendarDateMap[dateKey] = [];
      }
      
      calendarDateMap[dateKey].push({
        id: event.id,
        title: event.title,
        start: eventDate,
        end: new Date(event.end),
        location: event.location,
        description: event.description,
        source: event.source,
        hasLink: event.meetingLink ? true : false
      });
    });
    
    // Sort events for each date by start time
    Object.keys(calendarDateMap).forEach(date => {
      calendarDateMap[date].sort((a, b) => a.start.getTime() - b.start.getTime());
    });
    
    const userMessage = `The current time is ${formattedTime}.

MY CALENDAR DATA:

TODAY'S MEETINGS (${todayEvents.length}):
${todayEvents.length > 0 ? formatEventsList(todayEvents) : "No meetings scheduled for today."}

TOMORROW'S MEETINGS (${tomorrowEvents.length}):
${tomorrowEvents.length > 0 ? formatEventsList(tomorrowEvents) : "No meetings scheduled for tomorrow."}

UPCOMING MEETINGS (${upcomingEvents.length}):
${upcomingEvents.length > 0 ? formatEventsList(upcomingEvents.slice(0, 10)) : "No upcoming meetings scheduled."}

RECENT PAST MEETINGS (${pastEvents.length}):
${pastEvents.length > 0 ? formatEventsList(pastEvents.slice(0, 5)) : "No recent past meetings."}

CALENDAR DATA BY DATE:
IMPORTANT: The following section contains the user's COMPLETE calendar data for ALL dates. 
- This data is complete and accurate.
- Do NOT invent events that aren't listed.
- Do NOT claim events exist when they are not listed below.
- NEVER say "I only have data from X to Y" - this data is complete for all dates mentioned in the query.
- CAREFULLY CHECK FOR OVERLAPPING MEETINGS when asked about conflicts or collisions.
- Meetings overlap if one meeting starts before another meeting ends (exact same time counts as an overlap).
- An empty or missing description/agenda field means that meeting has NO AGENDA.
- When asked about meetings without agendas, look for events where hasDescription or hasAgenda is false.

${Object.keys(calendarDateMap)
  .sort()
  .map(date => {
    const dateObj = new Date(date);
    const formattedDate = `${dayNames[dateObj.getDay()]}, ${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
    const dateEvents = calendarDateMap[date];
    
    // Count events with and without agenda
    const eventsWithAgenda = dateEvents.filter(event => 
      event.description && 
      typeof event.description === 'string' && 
      event.description.trim() !== '' && 
      event.description !== 'No description available'
    ).length;
    const eventsWithoutAgenda = dateEvents.length - eventsWithAgenda;
    
    // Debug output to understand what's happening
    console.log(`Date ${date}: ${dateEvents.length} total events, ${eventsWithAgenda} with agenda, ${eventsWithoutAgenda} without agenda`);
    
    const formattedEvents = dateEvents.map(event => {
      const startTime = event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const endTime = event.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const hasAgenda = event.description && 
                      typeof event.description === 'string' && 
                      event.description.trim() !== '' && 
                      event.description !== 'No description available';
      
      return `• **${event.title}** from ${startTime} to ${endTime} ${hasAgenda ? '(Has agenda)' : '(No agenda)'}`;
    }).join('\n');
    
    return `${formattedDate} (${dateEvents.length} meetings, ${eventsWithoutAgenda} without agenda):\n${formattedEvents}`;
  })
  .join('\n\n')}

Based on this calendar data, please answer my question: ${query}`;

    // Use Claude 3 Sonnet for better understanding and more accurate responses
    const message = await anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 1000,
      temperature: 0.0, // Zero temperature for maximum accuracy
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userMessage
        }
      ]
    });
    
    const aiResponse = message.content[0].text;
    
    // Find related events for highlighting in the calendar
    let relatedEvents = [];
    
    // Process query to determine which events to highlight
    const normalizedQuery = query.toLowerCase();
    
    // For today queries
    if (normalizedQuery.includes('today')) {
      relatedEvents = events.filter(event => 
        event.start.includes(todayStr)
      );
    } 
    // For tomorrow queries
    else if (normalizedQuery.includes('tomorrow')) {
      relatedEvents = events.filter(event => 
        event.start.includes(tomorrowStr)
      );
    } 
    // For date format queries (e.g., 21/04/2025 or 2025-04-21)
    else if (normalizedQuery.match(/\d{1,2}\/\d{1,2}\/\d{4}/) || normalizedQuery.match(/\d{4}-\d{1,2}-\d{1,2}/)) {
      // Extract date from the query
      let targetDate;
      
      // Try DD/MM/YYYY format
      const ddmmyyyyMatch = normalizedQuery.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (ddmmyyyyMatch) {
        const [_, day, month, year] = ddmmyyyyMatch;
        targetDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      } else {
        // Try YYYY-MM-DD format
        const yyyymmddMatch = normalizedQuery.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (yyyymmddMatch) {
          const [_, year, month, day] = yyyymmddMatch;
          targetDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        }
      }
      
      if (targetDate && !isNaN(targetDate.getTime())) {
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        // Highlight events for the target date
        relatedEvents = events.filter(event => 
          event.start.includes(targetDateStr)
        );
      }
    }
    // For weekday queries
    else if (normalizedQuery.includes('monday') || normalizedQuery.includes('tuesday') || 
        normalizedQuery.includes('wednesday') || normalizedQuery.includes('thursday') || 
        normalizedQuery.includes('friday') || normalizedQuery.includes('saturday') || 
        normalizedQuery.includes('sunday')) {
      
      // Check for weekday names
      const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      let matchedWeekday = -1;
      let isNextWeek = false;
      
      // Find mentioned weekday
      for (let i = 0; i < weekdayNames.length; i++) {
        if (normalizedQuery.includes(weekdayNames[i])) {
          matchedWeekday = i;
          isNextWeek = normalizedQuery.includes("next");
          break;
        }
      }
      
      if (matchedWeekday >= 0) {
        // Calculate target date
        const currentDayOfWeek = currentTime.getDay();
        const targetDate = new Date(currentTime);
        let daysToAdd = matchedWeekday - currentDayOfWeek;
        
        // If target day is before today or if explicitly asking for next week
        if (daysToAdd <= 0 || isNextWeek) {
          daysToAdd += 7; // Go to next week
        }
        
        targetDate.setDate(currentTime.getDate() + daysToAdd);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        // Highlight events for the target date
        relatedEvents = events.filter(event => 
          event.start.includes(targetDateStr)
        );
      }
    }
    // For next meeting queries
    else if (normalizedQuery.includes('next meeting') || normalizedQuery.includes('next appointment')) {
      const nextEvent = events
        .filter(event => new Date(event.start) > currentTime)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
      
      if (nextEvent) {
        relatedEvents = [nextEvent];
      }
    }
    // For person queries
    else if (normalizedQuery.includes('with')) {
      const potentialPersons = extractPotentialPersons(normalizedQuery);
      if (potentialPersons.length > 0) {
        relatedEvents = events.filter(event => 
          potentialPersons.some(person => 
            (event.title?.toLowerCase().includes(person.toLowerCase()) || 
             event.description?.toLowerCase().includes(person.toLowerCase()))
          )
        );
      }
    }
    // For keyword queries
    else {
      const keywords = extractKeywords(normalizedQuery);
      if (keywords.length > 0) {
        relatedEvents = events.filter(event => 
          keywords.some(keyword => 
            (event.title?.toLowerCase().includes(keyword) || 
             event.description?.toLowerCase().includes(keyword) ||
             event.location?.toLowerCase().includes(keyword))
          )
        );
      }
    }
    
    return { 
      answer: aiResponse,
      relatedEvents: relatedEvents.length > 0 ? relatedEvents : undefined 
    };
  } catch (error) {
    console.error('Claude API error:', error);
    throw error; // Let the caller handle the fallback
  }
}

/**
 * Format a list of events into readable text with concise formatting
 */
function formatEventsList(events) {
  return events.map((event) => {
    return `• **${event.title}** ${event.timeRange}`;
  }).join('\n');
}

/**
 * Try to extract people names from event titles and descriptions
 */
function extractPeopleFromTitle(title, description) {
  // Simple extraction based on common patterns
  const people = [];
  const combined = title + ' ' + description;
  
  // Look for "with [Name]" pattern
  const withMatches = combined.match(/with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g);
  if (withMatches) {
    withMatches.forEach(match => {
      const person = match.replace('with ', '').trim();
      if (person && !people.includes(person)) {
        people.push(person);
      }
    });
  }
  
  return people;
}

/**
 * Extract potential person names from a query
 */
function extractPotentialPersons(query) {
  // Look for "with [Name]" pattern
  const withMatch = query.match(/with\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
  if (withMatch && withMatch[1]) {
    return [withMatch[1].trim()];
  }
  return [];
}

/**
 * Extract significant keywords from a query
 */
function extractKeywords(query) {
  // Skip common words and extract meaningful keywords
  const commonWords = ['meeting', 'meetings', 'calendar', 'schedule', 'appointment', 'appointments', 
                      'the', 'a', 'an', 'in', 'on', 'at', 'with', 'and', 'or', 'for', 'about', 
                      'have', 'has', 'had', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 
                      'being', 'been', 'this', 'that', 'these', 'those', 'any', 'all', 'some',
                      'how', 'many', 'much', 'when', 'where', 'what', 'who', 'why', 'which',
                      'today', 'tomorrow', 'yesterday', 'next', 'previous', 'week', 'month', 'day'];
  
  // First try to extract specific meeting types that people might search for
  const meetingTypes = ['interview', 'standup', 'review', 'planning', 'retrospective', 'demo',
                        'presentation', 'workshop', '1:1', 'one-on-one', 'sync', 'catch-up',
                        'check-in', 'orientation', 'training', 'feedback'];
  
  const words = query.toLowerCase()
    .replace(/[^\w\s-]/gi, '') // Remove punctuation except hyphens
    .split(/\s+/);
  
  // Check for meeting types
  const foundTypes = meetingTypes.filter(type => 
    words.some(word => word === type || word === type + 's' || word === type + 'ing')
  );
  
  if (foundTypes.length > 0) {
    return foundTypes;
  }
  
  // Fall back to filtering out common words
  const extractedKeywords = words.filter(word => word.length > 2 && !commonWords.includes(word));
  
  // If we end up with no keywords, include the last non-common word as a last resort
  if (extractedKeywords.length === 0 && words.length > 0) {
    const lastWord = words[words.length - 1];
    if (lastWord.length > 2) {
      return [lastWord];
    }
  }
  
  return extractedKeywords;
}

/**
 * Process user query about calendar events (rule-based fallback approach)
 */
async function processCalendarQuery(query: string, events: CalendarEventData[]) {
  const normalizedQuery = query.toLowerCase().trim();
  let relatedEvents = findRelatedEvents(normalizedQuery, events);
  let answer = '';
  
  // Look for time-related keywords
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  // Handle weekday queries
  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const currentDayOfWeek = today.getDay();
  
  let matchedWeekday = -1;
  let isNextWeek = false;
  
  // Check for weekday mentions
  for (let i = 0; i < weekdayNames.length; i++) {
    if (normalizedQuery.includes(weekdayNames[i])) {
      matchedWeekday = i;
      isNextWeek = normalizedQuery.includes("next");
      break;
    }
  }
  
  // Time-based queries
  if (normalizedQuery.includes('today') || normalizedQuery.includes('meetings today')) {
    relatedEvents = events.filter(event => 
      event.start.includes(todayStr)
    );
    
    if (relatedEvents.length === 0) {
      answer = 'You have no meetings scheduled for today.';
    } else {
      // Check if query is asking for count only
      const isCountQuery = normalizedQuery.includes('how many') || normalizedQuery.includes('number of');
      
      if (isCountQuery) {
        answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} today. Would you like me to list them?`;
      } else {
        answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} today:`;
        answer += formatMeetingsList(relatedEvents);
      }
    }
  } 
  else if (normalizedQuery.includes('tomorrow') || normalizedQuery.includes('meetings tomorrow')) {
    relatedEvents = events.filter(event => 
      event.start.includes(tomorrowStr)
    );
    
    if (relatedEvents.length === 0) {
      answer = 'You have no meetings scheduled for tomorrow.';
    } else {
      // Check if query is asking for count only
      const isCountQuery = normalizedQuery.includes('how many') || normalizedQuery.includes('number of');
      
      if (isCountQuery) {
        answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} tomorrow. Would you like me to list them?`;
      } else {
        answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} tomorrow:`;
        answer += formatMeetingsList(relatedEvents);
      }
    }
  }
  // Date format queries (e.g., 21/04/2025 or 2025-04-21)
  else if (normalizedQuery.match(/\d{1,2}\/\d{1,2}\/\d{4}/) || normalizedQuery.match(/\d{4}-\d{1,2}-\d{1,2}/)) {
    // Extract date from the query
    let targetDate;
    
    // Try DD/MM/YYYY format
    const ddmmyyyyMatch = normalizedQuery.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ddmmyyyyMatch) {
      const [_, day, month, year] = ddmmyyyyMatch;
      targetDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    } else {
      // Try YYYY-MM-DD format
      const yyyymmddMatch = normalizedQuery.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (yyyymmddMatch) {
        const [_, year, month, day] = yyyymmddMatch;
        targetDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      }
    }
    
    if (targetDate && !isNaN(targetDate.getTime())) {
      const targetDateStr = targetDate.toISOString().split('T')[0];
      const monthNames = ["January", "February", "March", "April", "May", "June",
                         "July", "August", "September", "October", "November", "December"];
      const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      
      // Find events for the specific date - ensure we're using the ISO date comparison
      relatedEvents = events.filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.toISOString().split('T')[0] === targetDateStr;
      }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      
      // Format for display
      const formattedDate = `${weekdayNames[targetDate.getDay()]}, ${monthNames[targetDate.getMonth()]} ${targetDate.getDate()}, ${targetDate.getFullYear()}`;
      
      if (relatedEvents.length === 0) {
        answer = `You have no meetings scheduled for ${formattedDate}.`;
      } else {
        // Check if query is asking for count only
        const isCountQuery = normalizedQuery.includes('how many') || normalizedQuery.includes('number of');
        
        if (isCountQuery) {
          answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} on ${formattedDate}. Would you like me to list them?`;
        } else {
          answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} on ${formattedDate}:`;
          answer += formatMeetingsList(relatedEvents);
        }
      }
    } else {
      answer = "I couldn't understand the date format. Please try using DD/MM/YYYY or YYYY-MM-DD format.";
    }
  }
  // Weekday-based queries
  else if (matchedWeekday >= 0) {
    // Calculate target date based on weekday and next week flag
    const targetDate = new Date(today);
    let daysToAdd = matchedWeekday - currentDayOfWeek;
    
    // If target day is before today or if explicitly asking for next week
    if (daysToAdd <= 0 || isNextWeek) {
      daysToAdd += 7; // Go to next week
    }
    
    targetDate.setDate(today.getDate() + daysToAdd);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    
    // Filter events for the target date - ensure we're using the ISO date comparison
    relatedEvents = events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.toISOString().split('T')[0] === targetDateStr;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    
    // Format the date for display
    const monthNames = ["January", "February", "March", "April", "May", "June",
                       "July", "August", "September", "October", "November", "December"];
    const formattedDate = `${weekdayNames[matchedWeekday].charAt(0).toUpperCase() + weekdayNames[matchedWeekday].slice(1)}, ${monthNames[targetDate.getMonth()]} ${targetDate.getDate()}`;
    
    if (relatedEvents.length === 0) {
      answer = `You have no meetings scheduled for ${isNextWeek ? 'next' : ''} ${weekdayNames[matchedWeekday]}.`;
    } else {
      // Check if query is asking for count only
      const isCountQuery = normalizedQuery.includes('how many') || normalizedQuery.includes('number of');
      
      if (isCountQuery) {
        answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} on ${isNextWeek ? 'next' : ''} ${weekdayNames[matchedWeekday]}. Would you like me to list them?`;
      } else {
        answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} on ${isNextWeek ? 'next' : ''} ${weekdayNames[matchedWeekday]}:`;
        answer += formatMeetingsList(relatedEvents);
      }
    }
  }
  // Meeting with specific person
  else if (normalizedQuery.includes('meeting with') || normalizedQuery.includes('meetings with')) {
    const person = extractPersonName(normalizedQuery);
    if (person) {
      relatedEvents = events.filter(event => 
        (event.title?.toLowerCase().includes(person.toLowerCase()) || 
         event.description?.toLowerCase().includes(person.toLowerCase()))
      );
      
      if (relatedEvents.length === 0) {
        answer = `I couldn't find any meetings with ${person}.`;
      } else {
        // Check if query is asking for count only
        const isCountQuery = normalizedQuery.includes('how many') || normalizedQuery.includes('number of');
        
        if (isCountQuery) {
          answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} with ${person}. Would you like me to list them?`;
        } else {
          answer = `You have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} with ${person}:`;
          answer += formatMeetingsList(relatedEvents);
        }
      }
    } else {
      answer = "Please specify the person's name you're looking for.";
    }
  }
  // Next meeting
  else if (normalizedQuery.includes('next meeting')) {
    const now = new Date();
    const upcomingEvents = events
      .filter(event => new Date(event.start) > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    
    if (upcomingEvents.length === 0) {
      answer = 'You have no upcoming meetings scheduled.';
    } else {
      const nextEvent = upcomingEvents[0];
      const startDate = new Date(nextEvent.start);
      const endDate = new Date(nextEvent.end);
      
      // Format with accurate time information
      const formattedDate = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const startTimeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const endTimeStr = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      
      answer = `Your next meeting is **${nextEvent.title}** on ${formattedDate} from ${startTimeStr} to ${endTimeStr}.`;
      
      // Only add meeting link info if available
      if (nextEvent.meetingLink) {
        answer += `\n\nThis meeting has an online meeting link.`;
      }
      
      relatedEvents = [nextEvent];
    }
  }
  // Free time/availability
  // Check for overlapping meetings
  else if (normalizedQuery.includes('overlap') || normalizedQuery.includes('conflict') || normalizedQuery.includes('collision') || normalizedQuery.includes('double book')) {
    // Determine the target date
    let targetDate = new Date();
    let targetEvents = [];
    
    if (normalizedQuery.includes('today')) {
      // Use today's date
      const todayStr = targetDate.toISOString().split('T')[0];
      targetEvents = events.filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.toISOString().split('T')[0] === todayStr;
      });
    } else if (normalizedQuery.includes('tomorrow')) {
      // Use tomorrow's date
      const tomorrow = new Date(targetDate);
      tomorrow.setDate(targetDate.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      targetEvents = events.filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.toISOString().split('T')[0] === tomorrowStr;
      });
    } else {
      // Default to all upcoming events
      targetEvents = events.filter(event => new Date(event.start) >= targetDate);
    }
    
    // Find overlapping meetings
    const { overlaps, hasOverlaps } = findOverlappingMeetings(targetEvents);
    
    if (!hasOverlaps) {
      if (normalizedQuery.includes('today')) {
        answer = "You don't have any overlapping meetings today.";
      } else if (normalizedQuery.includes('tomorrow')) {
        answer = "You don't have any overlapping meetings tomorrow.";
      } else {
        answer = "You don't have any overlapping meetings in your schedule.";
      }
    } else {
      // Format the overlapping meetings for display
      let timeframe = normalizedQuery.includes('today') ? "today" : 
                     normalizedQuery.includes('tomorrow') ? "tomorrow" : 
                     "in your schedule";
      
      answer = `Yes, you have ${overlaps.length} overlapping meeting ${overlaps.length === 1 ? 'pair' : 'pairs'} ${timeframe}:\n\n`;
      
      overlaps.forEach((overlap, index) => {
        // Ensure we have Date objects by using the original event properties if needed
        const event1StartDate = overlap.event1.startDate || new Date(overlap.event1.start);
        const event1EndDate = overlap.event1.endDate || new Date(overlap.event1.end);
        
        const event2StartDate = overlap.event2.startDate || new Date(overlap.event2.start);
        const event2EndDate = overlap.event2.endDate || new Date(overlap.event2.end);
        
        const event1Start = event1StartDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const event1End = event1EndDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        const event2Start = event2StartDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const event2End = event2EndDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        const overlapStartTime = overlap.overlapStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const overlapEndTime = overlap.overlapEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        answer += `Conflict ${index + 1}:\n`;
        answer += `• **${overlap.event1.title}** from ${event1Start} to ${event1End}\n`;
        answer += `• **${overlap.event2.title}** from ${event2Start} to ${event2End}\n`;
        answer += `These meetings overlap between ${overlapStartTime} and ${overlapEndTime}.\n\n`;
      });
      
      // Add the related events for highlighting
      relatedEvents = overlaps.flatMap(overlap => [overlap.event1, overlap.event2]);
    }
  }
  else if (normalizedQuery.includes('free time') || normalizedQuery.includes('available') || normalizedQuery.includes('busy') || normalizedQuery.match(/free at \d/)) {
    const now = new Date();
    
    // Check if the query is about a specific time
    // Match both direct time queries and "after/before X time" queries
    const timeMatch = normalizedQuery.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const afterTimeMatch = normalizedQuery.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const beforeTimeMatch = normalizedQuery.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    
    // Function to parse a time from a regex match
    const parseTimeFromMatch = (match) => {
      const hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const isPM = match[3].toLowerCase() === 'pm' && hour < 12;
      
      // Convert to 24-hour format
      const queryHour = isPM ? hour + 12 : (hour === 12 && match[3].toLowerCase() === 'am' ? 0 : hour);
      
      // Create a Date object for the query time
      const queryTime = new Date();
      queryTime.setHours(queryHour, minute, 0, 0);
      
      return {
        time: queryTime,
        displayTime: `${match[1]}${match[2] ? ':' + match[2] : ''}${match[3]}`
      };
    };
    
    if (afterTimeMatch) {
      // "Am I free after X time" query
      const { time: afterTime, displayTime } = parseTimeFromMatch(afterTimeMatch);
      
      // Check if this time is in the past
      if (afterTime < now) {
        afterTime.setHours(afterTime.getHours() + 12); // Try PM if AM was in the past
      }
      
      // Find events that start after this time today
      const laterEvents = events.filter(event => {
        const eventStart = new Date(event.start);
        return eventStart.toISOString().split('T')[0] === todayStr && 
               eventStart >= afterTime;
      }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      
      if (laterEvents.length === 0) {
        answer = `Yes, you're free after ${displayTime}.`;
      } else {
        // Check if there's a gap between afterTime and the first meeting
        const nextEvent = laterEvents[0];
        const nextEventStart = new Date(nextEvent.start);
        
        // If the next event is more than 30 min away, they have some free time
        if ((nextEventStart.getTime() - afterTime.getTime()) > 30 * 60 * 1000) {
          answer = `Yes, you're free after ${displayTime} until ${formatTime(nextEventStart.toISOString())}.`;
        } else {
          answer = `No, you have "${nextEvent.title}" at ${formatTime(nextEventStart.toISOString())}.`;
        }
      }
    }
    else if (beforeTimeMatch) {
      // "Am I free before X time" query
      const { time: beforeTime, displayTime } = parseTimeFromMatch(beforeTimeMatch);
      
      // Find events that end before this time today
      const earlierEvents = events.filter(event => {
        const eventEnd = new Date(event.end);
        const eventStart = new Date(event.start); 
        return eventStart.toISOString().split('T')[0] === todayStr && 
               eventStart < beforeTime && eventEnd > now;
      }).sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());
      
      if (earlierEvents.length === 0) {
        if (beforeTime < now) {
          answer = "That time has already passed.";
        } else {
          answer = `Yes, you're free before ${displayTime}.`;
        }
      } else {
        // The last event that ends before the specified time
        const lastEvent = earlierEvents[earlierEvents.length - 1];
        const lastEventEnd = new Date(lastEvent.end);
        
        // If there's less than 30 min between now and the start time, or if they're in a meeting now
        if ((beforeTime.getTime() - lastEventEnd.getTime()) < 30 * 60 * 1000 || 
            (new Date(lastEvent.start) <= now && lastEventEnd > now)) {
          answer = `No, you have "${lastEvent.title}" until ${formatTime(lastEventEnd.toISOString())}.`;
        } else {
          answer = `Yes, you're free from ${formatTime(lastEventEnd.toISOString())} until ${displayTime}.`;
        }
      }
    }
    else if (timeMatch) {
      // This is a query about availability at a specific time
      const { time: queryTime, displayTime } = parseTimeFromMatch(timeMatch);
      
      // Check if this time is in the past
      if (queryTime < now) {
        answer = 'That time has already passed today.';
      } else {
        // Find events that overlap with this time
        const overlappingEvents = events.filter(event => {
          const eventStart = new Date(event.start);
          const eventEnd = new Date(event.end);
          return eventStart.toISOString().split('T')[0] === todayStr && 
                 eventStart <= queryTime && eventEnd > queryTime;
        });
        
        if (overlappingEvents.length === 0) {
          answer = `Yes, you're free at ${displayTime}.`;
        } else {
          const event = overlappingEvents[0];
          const eventStart = new Date(event.start);
          const eventEnd = new Date(event.end);
          answer = `No, you have "${event.title}" from ${formatTime(eventStart.toISOString())} to ${formatTime(eventEnd.toISOString())}.`;
        }
      }
    }
    // General availability query
    else {
      const todayEvents = events.filter(event => 
        event.start.includes(todayStr) && new Date(event.end) > now
      ).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      
      if (todayEvents.length === 0) {
        answer = 'You have no more meetings today.';
      } else {
        // Find free slots first
        const freeSlots = findFreeSlots(todayEvents, now);
        
        if (freeSlots.length > 0) {
          if (normalizedQuery.includes('when')) {
            answer = `Free times today: ${freeSlots.map(slot => slot.replace('From ', '')).join(' and ')}.`;
          } else {
            answer = 'Yes, you have free time today.';
            
            // If they explicitly asked when they're free
            if (normalizedQuery.includes('when')) {
              answer += ` ${freeSlots.map(slot => slot.toLowerCase()).join(' and ')}.`;
            }
          }
          
          // If query specifically asks about meetings/busy times
          if (normalizedQuery.includes('busy') || normalizedQuery.includes('meeting')) {
            answer = 'Your busy periods today:';
            const busyTimes = todayEvents.map(event => 
              `• **${event.title}** from ${formatTime(new Date(event.start).toISOString())} to ${formatTime(new Date(event.end).toISOString())}`
            ).join('\n');
            answer += '\n' + busyTimes;
          }
        } else {
          answer = 'No free time remaining today.';
          
          if (normalizedQuery.includes('busy') || normalizedQuery.includes('meeting')) {
            answer += '\n\nYour schedule:';
            const busyTimes = todayEvents.map(event => 
              `• **${event.title}** from ${formatTime(new Date(event.start).toISOString())} to ${formatTime(new Date(event.end).toISOString())}`
            ).join('\n');
            answer += '\n' + busyTimes;
          }
        }
      }
      
      relatedEvents = todayEvents;
    }
  }
  // Check for meetings without agenda/description
  else if (normalizedQuery.includes('agenda') || normalizedQuery.includes('description') || 
           normalizedQuery.includes('details') || normalizedQuery.includes('notes')) {
    
    // Determine which day to look at
    let targetDate = new Date();
    let targetDateStr = targetDate.toISOString().split('T')[0];
    let timeframe = 'today';
    
    if (normalizedQuery.includes('tomorrow')) {
      targetDate.setDate(targetDate.getDate() + 1);
      targetDateStr = targetDate.toISOString().split('T')[0];
      timeframe = 'tomorrow';
    } else if (normalizedQuery.includes('yesterday')) {
      targetDate.setDate(targetDate.getDate() - 1);
      targetDateStr = targetDate.toISOString().split('T')[0];
      timeframe = 'yesterday';
    }
    
    // Get events for the target date
    const dateEvents = events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.toISOString().split('T')[0] === targetDateStr;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    
    // Check if looking for meetings WITH or WITHOUT agenda
    const lookingForNoAgenda = normalizedQuery.includes('no agenda') || 
                              normalizedQuery.includes('without agenda') ||
                              normalizedQuery.includes('missing agenda') ||
                              normalizedQuery.includes('no description') ||
                              normalizedQuery.includes('without description');
    
    if (lookingForNoAgenda) {
      // Find meetings WITHOUT agenda/description
      const eventsWithoutAgenda = dateEvents.filter(event => {
        // Log each event to understand what's happening
        console.log('Event description check:', {
          id: event.id, 
          title: event.title,
          description: event.description,
          hasDescription: Boolean(event.description && typeof event.description === 'string' && event.description.trim() !== '')
        });
        
        // An event has no agenda if:
        // 1. description is undefined or null
        // 2. description is an empty string or only whitespace
        // 3. description is the placeholder "No description available"
        return !event.description || 
               typeof event.description !== 'string' ||
               event.description.trim() === '' || 
               event.description === 'No description available';
      });
      
      if (eventsWithoutAgenda.length === 0) {
        answer = `No meetings ${timeframe} are missing agenda or descriptions.`;
      } else {
        answer = `${eventsWithoutAgenda.length} meeting${eventsWithoutAgenda.length === 1 ? '' : 's'} ${timeframe} ${eventsWithoutAgenda.length === 1 ? 'has' : 'have'} no agenda:`;
        
        const formattedMeetings = eventsWithoutAgenda.map(event => {
          const startTime = new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          const endTime = new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          return `• **${event.title}** from ${startTime} to ${endTime}`;
        }).join('\n');
        
        answer += '\n' + formattedMeetings;
        relatedEvents = eventsWithoutAgenda;
      }
    } else {
      // Find meetings WITH agenda/description
      const eventsWithAgenda = dateEvents.filter(event => 
        event.description && 
        typeof event.description === 'string' && 
        event.description.trim() !== '' && 
        event.description !== 'No description available'
      );
      
      if (eventsWithAgenda.length === 0) {
        answer = `No meetings ${timeframe} have agenda or descriptions.`;
      } else {
        answer = `${eventsWithAgenda.length} meeting${eventsWithAgenda.length === 1 ? '' : 's'} ${timeframe} ${eventsWithAgenda.length === 1 ? 'has' : 'have'} an agenda:`;
        
        const formattedMeetings = eventsWithAgenda.map(event => {
          const startTime = new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          const endTime = new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          return `• **${event.title}** from ${startTime} to ${endTime}`;
        }).join('\n');
        
        answer += '\n' + formattedMeetings;
        relatedEvents = eventsWithAgenda;
      }
    }
  }
  // Search for specific meeting types (interviews, 1:1s, etc.)
  else if (normalizedQuery.includes('interview') || 
          normalizedQuery.includes('1:1') || 
          normalizedQuery.includes('one on one') ||
          normalizedQuery.includes('standup') ||
          (normalizedQuery.includes('how many') && normalizedQuery.match(/how many (.+?) (?:meetings|do I have)/))) {
    
    // Extract the meeting type from the query
    let meetingType = '';
    
    if (normalizedQuery.includes('interview')) {
      meetingType = 'interview';
    } else if (normalizedQuery.includes('1:1') || normalizedQuery.includes('one on one')) {
      meetingType = '1:1';
    } else if (normalizedQuery.includes('standup')) {
      meetingType = 'standup';
    } else {
      // Extract custom meeting type from query like "how many [type] meetings"
      const typeMatch = normalizedQuery.match(/how many (.+?) (?:meetings|do I have)/);
      if (typeMatch && typeMatch[1]) {
        meetingType = typeMatch[1].trim();
      }
    }
    
    if (!meetingType) {
      answer = "I'm not sure what type of meetings you're looking for. Could you specify?";
    } else {
      // Determine the time range (this week, next week, etc.)
      const today = new Date();
      const startOfToday = new Date(today.setHours(0, 0, 0, 0));
      
      let startDate = new Date(startOfToday);
      let endDate = new Date(startOfToday);
      let timeDescription = '';
      
      if (normalizedQuery.includes('this week')) {
        // Set to start of current week (Sunday)
        const dayOfWeek = startDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
        startDate.setDate(startDate.getDate() - dayOfWeek); // Go back to Sunday
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 7); // End of week (next Sunday)
        timeDescription = 'this week';
      } else if (normalizedQuery.includes('next week')) {
        // Set to start of next week
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek + 7); // Next Sunday
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 7); // End of next week
        timeDescription = 'next week';
      } else if (normalizedQuery.includes('tomorrow')) {
        startDate.setDate(startDate.getDate() + 1);
        endDate.setDate(endDate.getDate() + 2); // End of tomorrow
        timeDescription = 'tomorrow';
      } else if (normalizedQuery.includes('today')) {
        endDate.setDate(endDate.getDate() + 1); // End of today
        timeDescription = 'today';
      } else if (normalizedQuery.includes('month')) {
        // Set to start of current month
        startDate.setDate(1);
        endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1); // End of month
        timeDescription = 'this month';
      } else {
        // Default to all upcoming events
        endDate.setMonth(endDate.getMonth() + 3); // Look ahead 3 months
        timeDescription = 'in the next 3 months';
      }
      
      // Find meetings that match the type during the specified time range
      const matchingEvents = events.filter(event => {
        const eventStart = new Date(event.start);
        const matchesTimeRange = eventStart >= startDate && eventStart < endDate;
        
        if (!matchesTimeRange) return false;
        
        // Check if event matches the meeting type in title or description
        const title = event.title.toLowerCase();
        const description = (event.description || '').toLowerCase();
        
        // Handle variations of the word (singular, plural, verb forms)
        const meetingTypeVariations = [
          meetingType, 
          meetingType + 's',     // Plural
          meetingType + 'ing',   // Gerund form
          meetingType.replace(/ing$/, ''),  // Remove 'ing' if present
          meetingType.replace(/s$/, '')     // Remove 's' if present
        ];
        
        return meetingTypeVariations.some(variation => 
          title.includes(variation) || description.includes(variation)
        );
      }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      
      if (matchingEvents.length === 0) {
        answer = `You don't have any ${meetingType} meetings ${timeDescription}.`;
      } else {
        answer = `You have ${matchingEvents.length} ${meetingType} meeting${matchingEvents.length === 1 ? '' : 's'} ${timeDescription}:`;
        
        const formattedMeetings = matchingEvents.map(event => {
          const eventDate = new Date(event.start);
          const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][eventDate.getDay()];
          const startTime = eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          const endTime = new Date(event.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          return `• **${event.title}** on ${dayName} from ${startTime} to ${endTime}`;
        }).join('\n');
        
        answer += '\n' + formattedMeetings;
        relatedEvents = matchingEvents;
      }
    }
  }
  // Search for a specific meeting
  else if (normalizedQuery.includes('find meeting') || normalizedQuery.includes('search for meeting')) {
    const keywords = extractKeywords(normalizedQuery);
    if (keywords.length > 0) {
      relatedEvents = events.filter(event => 
        keywords.some(keyword => 
          event.title?.toLowerCase().includes(keyword) || 
          event.description?.toLowerCase().includes(keyword) ||
          event.location?.toLowerCase().includes(keyword)
        )
      );
      
      if (relatedEvents.length === 0) {
        answer = `I couldn't find any meetings matching your search terms.`;
      } else {
        // Check if query is asking for count only
        const isCountQuery = normalizedQuery.includes('how many') || normalizedQuery.includes('number of');
        
        if (isCountQuery) {
          answer = `I found ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} matching your search. Would you like me to list them?`;
        } else {
          answer = `I found ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} matching your search:`;
          answer += formatMeetingsList(relatedEvents);
        }
      }
    } else {
      answer = "Please provide some keywords to search for in your meetings.";
    }
  }
  // Default response
  else {
    // For any other query, provide a general summary
    const now = new Date();
    const upcomingEvents = events
      .filter(event => new Date(event.start) > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 3);
    
    if (upcomingEvents.length === 0) {
      answer = 'You have no upcoming meetings scheduled.';
    } else {
      answer = `You have ${upcomingEvents.length} upcoming meetings. Here are the next few:`;
      answer += formatMeetingsList(upcomingEvents.slice(0, 3));
      
      if (upcomingEvents.length > 3) {
        answer += '\n\nWould you like to see more?';
      }
      
      relatedEvents = upcomingEvents;
    }
  }
  
  return { 
    answer, 
    relatedEvents: relatedEvents.length > 0 ? relatedEvents : undefined 
  };
}

/**
 * Find events related to the user's query
 */
function findRelatedEvents(query: string, events: CalendarEventData[]) {
  const normalizedQuery = query.toLowerCase().trim();
  const keywords = extractKeywords(normalizedQuery);
  
  // If there are no meaningful keywords, return empty array
  if (keywords.length === 0) {
    return [];
  }
  
  // Find events that match any of the keywords
  return events.filter(event => 
    keywords.some(keyword => 
      event.title?.toLowerCase().includes(keyword) || 
      event.description?.toLowerCase().includes(keyword) ||
      event.location?.toLowerCase().includes(keyword)
    )
  );
}

// Helper functions

function formatMeetingsList(events: CalendarEventData[]): string {
  const formattedList = events.map(event => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    return `• **${event.title}** from ${formatTime(event.start)} to ${formatTime(event.end)}`;
  }).join('\n');
  
  return `\n${formattedList}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function extractPersonName(query: string): string | null {
  const withMatch = query.match(/(?:meeting|meetings) with (.+?)(?:$|\?|on|at|in)/i);
  if (withMatch && withMatch[1]) {
    return withMatch[1].trim();
  }
  return null;
}

/**
 * Find overlapping meetings in a list of events
 */
function findOverlappingMeetings(events: CalendarEventData[]): { 
  overlaps: { 
    event1: CalendarEventData & { startDate?: Date, endDate?: Date },
    event2: CalendarEventData & { startDate?: Date, endDate?: Date },
    overlapStart: Date, 
    overlapEnd: Date 
  }[],
  hasOverlaps: boolean
} {
  const result = {
    overlaps: [],
    hasOverlaps: false
  };
  
  if (events.length < 2) return result;
  
  // Convert all dates to Date objects for comparison
  const eventsWithDates = events.map(event => {
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);
    return {
      ...event,
      startDate,
      endDate
    };
  });
  
  // Sort events by start time
  const sortedEvents = [...eventsWithDates].sort((a, b) => 
    a.startDate.getTime() - b.startDate.getTime()
  );
  
  // Check each event against all later events for overlaps
  for (let i = 0; i < sortedEvents.length - 1; i++) {
    const event1 = sortedEvents[i];
    
    for (let j = i + 1; j < sortedEvents.length; j++) {
      const event2 = sortedEvents[j];
      
      // If event2 starts before event1 ends, we have an overlap
      if (event2.startDate < event1.endDate) {
        const overlapStart = new Date(Math.max(event1.startDate.getTime(), event2.startDate.getTime()));
        const overlapEnd = new Date(Math.min(event1.endDate.getTime(), event2.endDate.getTime()));
        
        result.overlaps.push({
          event1,
          event2,
          overlapStart,
          overlapEnd
        });
        
        result.hasOverlaps = true;
      }
    }
  }
  
  return result;
}

function findFreeSlots(events: CalendarEventData[], now: Date): string[] {
  if (events.length === 0) return [];
  
  const endOfDay = new Date(now);
  endOfDay.setHours(18, 0, 0); // Assuming work day ends at 6 PM
  
  // Sort events by start time
  const sortedEvents = [...events].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  
  const freeSlots = [];
  let lastEndTime = now;
  
  for (const event of sortedEvents) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    
    // If there's a gap between last meeting and this one
    if (eventStart.getTime() - lastEndTime.getTime() > 30 * 60 * 1000) { // 30 minutes
      freeSlots.push(`From ${formatTime(lastEndTime.toISOString())} to ${formatTime(eventStart.toISOString())}`);
    }
    
    // Update last end time if this meeting ends later
    if (eventEnd > lastEndTime) {
      lastEndTime = eventEnd;
    }
  }
  
  // Add any free time after the last meeting until end of day
  if (endOfDay.getTime() - lastEndTime.getTime() > 30 * 60 * 1000) { // 30 minutes
    freeSlots.push(`From ${formatTime(lastEndTime.toISOString())} to ${formatTime(endOfDay.toISOString())}`);
  }
  
  return freeSlots;
} 