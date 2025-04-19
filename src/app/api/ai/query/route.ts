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
    const systemPrompt = `You are an expert Calendar Assistant AI that excels at analyzing calendar data and answering questions about meetings, schedules, and availability.

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
Assistant: "You have 3 meetings today:

• **Product Review** from 10:00 AM to 11:00 AM
• **Team Standup** from 1:30 PM to 2:00 PM
• **Client Call** from 4:00 PM to 4:30 PM"

User: "When am I free tomorrow?"
Assistant: "Tomorrow's schedule:

**Busy periods:**
• 9:00 AM - 10:30 AM: **Morning Sync**
• 2:00 PM - 3:00 PM: **Project Update**

**Free periods:**
• 10:30 AM - 2:00 PM
• After 3:00 PM"

User: "Do I have any meetings with Sarah?"
Assistant: "Yes, you have 2 upcoming meetings with Sarah:

• **Project Planning** from 11:00 AM to 12:00 PM on Thursday, June 12
• **Budget Review** from 2:00 PM to 3:00 PM on Monday, June 16"

User: "What meetings do I have next Monday?"
Assistant: "For Monday, April 26 (next Monday), you have 3 meetings:

• **Team Sync** from 9:00 AM to 9:30 AM
• **Product Review** from 1:00 PM to 2:30 PM
• **Weekly Planning** from 4:00 PM to 4:30 PM"

User: "What meetings do I have on 21/04/2025?"
Assistant: "For Monday, April 21, 2025, you have 2 meetings:

• **Team Standup** from 10:00 AM to 10:30 AM
• **Client Presentation** from 2:00 PM to 3:30 PM"`;

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

${Object.keys(calendarDateMap)
  .sort()
  .map(date => {
    const dateObj = new Date(date);
    const formattedDate = `${dayNames[dateObj.getDay()]}, ${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
    const dateEvents = calendarDateMap[date];
    
    const formattedEvents = dateEvents.map(event => {
      const startTime = event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const endTime = event.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `• **${event.title}** from ${startTime} to ${endTime}`;
    }).join('\n');
    
    return `${formattedDate} (${dateEvents.length} meetings):\n${formattedEvents}`;
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
                      'being', 'been', 'this', 'that', 'these', 'those', 'any', 'all', 'some'];
  
  return query.toLowerCase()
    .replace(/[^\w\s]/gi, '') // Remove punctuation
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.includes(word));
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
      answer = '**Today\'s Schedule:**\n\nYou have no meetings scheduled for today.';
    } else {
      answer = `**Today's Schedule:**\n\nYou have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} today.`;
      answer += formatMeetingsList(relatedEvents);
    }
  } 
  else if (normalizedQuery.includes('tomorrow') || normalizedQuery.includes('meetings tomorrow')) {
    relatedEvents = events.filter(event => 
      event.start.includes(tomorrowStr)
    );
    
    if (relatedEvents.length === 0) {
      answer = '**Tomorrow\'s Schedule:**\n\nYou have no meetings scheduled for tomorrow.';
    } else {
      answer = `**Tomorrow's Schedule:**\n\nYou have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} tomorrow.`;
      answer += formatMeetingsList(relatedEvents);
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
        answer = `**${formattedDate} Schedule:**\n\nYou have no meetings scheduled for ${formattedDate}.`;
      } else {
        answer = `**${formattedDate} Schedule:**\n\nYou have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} scheduled for this date.`;
        answer += formatMeetingsList(relatedEvents);
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
      answer = `**${formattedDate} Schedule:**\n\nYou have no meetings scheduled for ${isNextWeek ? 'next' : ''} ${weekdayNames[matchedWeekday]}.`;
    } else {
      answer = `**${formattedDate} Schedule:**\n\nYou have ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} scheduled for ${isNextWeek ? 'next' : ''} ${weekdayNames[matchedWeekday]}.`;
      answer += formatMeetingsList(relatedEvents);
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
        answer = `I couldn't find any meetings with **${person}**.`;
      } else {
        answer = `**Meetings with ${person}:**\n\nI found ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} with **${person}**.`;
        answer += formatMeetingsList(relatedEvents);
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
      
      answer = `**Next Meeting:**\n\nYour next meeting is **${nextEvent.title}** on ${formattedDate} from ${startTimeStr} to ${endTimeStr}.`;
      
      // Only add meeting link info if available
      if (nextEvent.meetingLink) {
        answer += `\n\nThis meeting has an online meeting link.`;
      }
      
      relatedEvents = [nextEvent];
    }
  }
  // Free time/availability
  else if (normalizedQuery.includes('free time') || normalizedQuery.includes('available') || normalizedQuery.includes('busy')) {
    const now = new Date();
    const todayEvents = events.filter(event => 
      event.start.includes(todayStr) && new Date(event.end) > now
    ).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    
    if (todayEvents.length === 0) {
      answer = '**Availability Today:**\n\nYou have no more meetings today. You are free for the rest of the day.';
    } else {
      answer = '**Availability Today:**\n\n';
      
      // Format busy times as bullet points
      answer += '**Busy periods:**\n';
      const busyTimes = todayEvents.map(event => 
        `• **${event.title}** from ${formatTime(event.start)} to ${formatTime(event.end)}`
      ).join('\n');
      answer += busyTimes;
      
      // Find free slots
      const freeSlots = findFreeSlots(todayEvents, now);
      if (freeSlots.length > 0) {
        answer += '\n\n**Free periods:**\n';
        answer += freeSlots.map(slot => `• ${slot}`).join('\n');
      } else {
        answer += '\n\nYou have no significant free time slots remaining today.';
      }
      
      relatedEvents = todayEvents;
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
        answer = `**Search Results:**\n\nI couldn't find any meetings matching your search terms.`;
      } else {
        answer = `**Search Results:**\n\nI found ${relatedEvents.length} meeting${relatedEvents.length === 1 ? '' : 's'} matching your search.`;
        answer += formatMeetingsList(relatedEvents);
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
      answer = '**Calendar Assistant:**\n\nYou have no upcoming meetings scheduled.';
    } else {
      answer = `**Upcoming Meetings:**\n\nHere are your next few meetings:`;
      answer += formatMeetingsList(upcomingEvents);
      answer += '\n\n**Tips:**\nYou can ask me about:\n• Your schedule today or tomorrow\n• Meetings with specific people\n• Your next meeting\n• When you are free';
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