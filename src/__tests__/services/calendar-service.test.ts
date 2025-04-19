import axios from 'axios';
import { getGoogleCalendarEvents, getMicrosoftCalendarEvents, mergeCalendarEvents, CalendarEvent } from '@/services/calendar-service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Calendar Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn(); // Suppress console.error for tests
    console.log = jest.fn(); // Suppress console.log for tests
  });

  describe('getGoogleCalendarEvents', () => {
    const mockGoogleResponse = {
      data: {
        items: [
          {
            id: 'event1',
            summary: 'Google Meeting',
            start: {
              dateTime: '2023-06-15T10:00:00Z',
            },
            end: {
              dateTime: '2023-06-15T11:00:00Z',
            },
            location: 'Google Meet Room',
            description: 'Meeting description',
            hangoutLink: 'https://meet.google.com/abc-def-ghi'
          },
          {
            id: 'event2',
            summary: 'All Day Event',
            start: {
              date: '2023-06-16',
            },
            end: {
              date: '2023-06-17',
            },
            description: 'All day event description'
          }
        ]
      }
    };

    test('fetches events from Google Calendar API successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockGoogleResponse);

      const events = await getGoogleCalendarEvents('test-access-token');

      // Verify axios was called with correct parameters
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-access-token',
          },
          params: expect.objectContaining({
            singleEvents: true,
            orderBy: 'startTime',
          }),
        })
      );

      // Verify events are correctly transformed
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(expect.objectContaining({
        id: 'event1',
        title: 'Google Meeting',
        location: 'Google Meet Room',
        description: 'Meeting description',
        source: 'google',
        allDay: false,
        meetingLink: 'https://meet.google.com/abc-def-ghi'
      }));

      // Verify the dates are correctly parsed
      expect(events[0].start).toBeInstanceOf(Date);
      expect(events[0].end).toBeInstanceOf(Date);

      // Verify all-day event handling
      expect(events[1].allDay).toBe(true);
    });

    test('handles error when fetching Google Calendar events', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

      const events = await getGoogleCalendarEvents('test-access-token');

      expect(console.error).toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    test('handles conference data for meeting links', async () => {
      const responseWithConferenceData = {
        data: {
          items: [
            {
              id: 'event3',
              summary: 'Conference Meeting',
              start: {
                dateTime: '2023-06-15T10:00:00Z',
              },
              end: {
                dateTime: '2023-06-15T11:00:00Z',
              },
              conferenceData: {
                entryPoints: [
                  {
                    entryPointType: 'video',
                    uri: 'https://meet.google.com/abc-def-ghi',
                    label: 'Google Meet'
                  }
                ]
              }
            }
          ]
        }
      };
      
      mockedAxios.get.mockResolvedValueOnce(responseWithConferenceData);

      const events = await getGoogleCalendarEvents('test-access-token');

      expect(events[0].meetingLink).toBe('https://meet.google.com/abc-def-ghi');
    });
  });

  describe('getMicrosoftCalendarEvents', () => {
    const mockMicrosoftResponse = {
      data: {
        value: [
          {
            id: 'msEvent1',
            subject: 'Teams Meeting',
            start: {
              dateTime: '2023-06-15T14:00:00Z',
            },
            end: {
              dateTime: '2023-06-15T15:00:00Z',
            },
            location: {
              displayName: 'Teams Room'
            },
            bodyPreview: 'Meeting notes',
            isAllDay: false,
            onlineMeeting: {
              joinUrl: 'https://teams.microsoft.com/meeting/123'
            }
          },
          {
            id: 'msEvent2',
            subject: 'All Day Conference',
            start: {
              dateTime: '2023-06-16T00:00:00Z',
            },
            end: {
              dateTime: '2023-06-17T00:00:00Z',
            },
            isAllDay: true
          }
        ]
      }
    };

    test('fetches events from Microsoft Calendar API successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockMicrosoftResponse);

      const events = await getMicrosoftCalendarEvents('test-access-token');

      // Verify axios was called with correct parameters
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/me/calendarView',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-access-token',
            Prefer: 'outlook.timezone="UTC"',
          },
          params: expect.objectContaining({
            $orderby: 'start/dateTime',
          }),
        })
      );

      // Verify events are correctly transformed
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(expect.objectContaining({
        id: 'msEvent1',
        title: 'Teams Meeting',
        location: 'Teams Room',
        description: 'Meeting notes',
        source: 'microsoft',
        allDay: false,
        meetingLink: 'https://teams.microsoft.com/meeting/123'
      }));

      // Verify the dates are correctly parsed
      expect(events[0].start).toBeInstanceOf(Date);
      expect(events[0].end).toBeInstanceOf(Date);

      // Verify all-day event handling
      expect(events[1].allDay).toBe(true);
    });

    test('handles error when fetching Microsoft Calendar events', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('API Error'));

      const events = await getMicrosoftCalendarEvents('test-access-token');

      expect(console.error).toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    test('handles invalid response data', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: {} }); // Missing value property

      const events = await getMicrosoftCalendarEvents('test-access-token');

      expect(console.error).toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    test('handles onlineMeetingUrl fallback', async () => {
      const responseWithAltMeetingUrl = {
        data: {
          value: [
            {
              id: 'msEvent3',
              subject: 'Alt Meeting',
              start: {
                dateTime: '2023-06-15T14:00:00Z',
              },
              end: {
                dateTime: '2023-06-15T15:00:00Z',
              },
              onlineMeetingUrl: 'https://teams.microsoft.com/altmeeting'
            }
          ]
        }
      };
      
      mockedAxios.get.mockResolvedValueOnce(responseWithAltMeetingUrl);

      const events = await getMicrosoftCalendarEvents('test-access-token');

      expect(events[0].meetingLink).toBe('https://teams.microsoft.com/altmeeting');
    });
  });

  describe('mergeCalendarEvents', () => {
    test('merges events from multiple sources', () => {
      const googleEvents: CalendarEvent[] = [
        {
          id: 'g1',
          title: 'Google Event 1',
          start: new Date('2023-06-15T09:00:00Z'),
          end: new Date('2023-06-15T10:00:00Z'),
          source: 'google'
        },
        {
          id: 'g2',
          title: 'Google Event 2',
          start: new Date('2023-06-15T13:00:00Z'),
          end: new Date('2023-06-15T14:00:00Z'),
          source: 'google'
        }
      ];

      const microsoftEvents: CalendarEvent[] = [
        {
          id: 'm1',
          title: 'Microsoft Event 1',
          start: new Date('2023-06-15T11:00:00Z'),
          end: new Date('2023-06-15T12:00:00Z'),
          source: 'microsoft'
        }
      ];

      const mergedEvents = mergeCalendarEvents(googleEvents, microsoftEvents);

      // Verify events are merged and sorted by start time
      expect(mergedEvents).toHaveLength(3);
      expect(mergedEvents[0].id).toBe('g1');
      expect(mergedEvents[1].id).toBe('m1');
      expect(mergedEvents[2].id).toBe('g2');
    });

    test('handles empty arrays', () => {
      // Test with empty arrays
      expect(mergeCalendarEvents([], [])).toEqual([]);
      
      // Test with one empty array
      const events: CalendarEvent[] = [
        {
          id: 'e1',
          title: 'Event 1',
          start: new Date('2023-06-15T09:00:00Z'),
          end: new Date('2023-06-15T10:00:00Z'),
          source: 'google'
        }
      ];
      
      expect(mergeCalendarEvents(events, [])).toEqual(events);
      expect(mergeCalendarEvents([], events)).toEqual(events);
    });

    test('handles undefined inputs', () => {
      const events: CalendarEvent[] = [
        {
          id: 'e1',
          title: 'Event 1',
          start: new Date('2023-06-15T09:00:00Z'),
          end: new Date('2023-06-15T10:00:00Z'),
          source: 'google'
        }
      ];
      
      // @ts-ignore - Testing edge case with undefined
      expect(mergeCalendarEvents(events, undefined)).toEqual(events);
      // @ts-ignore - Testing edge case with undefined
      expect(mergeCalendarEvents(undefined, events)).toEqual(events);
      // @ts-ignore - Testing edge case with undefined
      expect(mergeCalendarEvents(undefined, undefined)).toEqual([]);
    });
  });
}); 