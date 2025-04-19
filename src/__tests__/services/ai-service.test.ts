import axios from 'axios';
import { queryAI } from '@/services/ai-service';
import { CalendarEvent } from '@/services/calendar-service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AI Service', () => {
  // Sample calendar events for testing
  const mockEvents: CalendarEvent[] = [
    {
      id: '1',
      title: 'Team Meeting',
      start: new Date('2023-06-15T10:00:00Z'),
      end: new Date('2023-06-15T11:00:00Z'),
      location: 'Conference Room A',
      description: 'Weekly team sync',
      source: 'google'
    },
    {
      id: '2',
      title: 'Lunch with John',
      start: new Date('2023-06-15T12:00:00Z'),
      end: new Date('2023-06-15T13:00:00Z'),
      location: 'Cafeteria',
      source: 'microsoft'
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn(); // Suppress console.error for tests
  });

  test('sends correct data to AI API and processes response', async () => {
    // Mock API response
    const mockResponse = {
      data: {
        answer: 'You have a team meeting at 10 AM and lunch with John at noon.',
        relatedEvents: [
          {
            id: '1',
            title: 'Team Meeting',
            start: '2023-06-15T10:00:00Z',
            end: '2023-06-15T11:00:00Z',
            location: 'Conference Room A',
            description: 'Weekly team sync',
            source: 'google'
          }
        ]
      }
    };

    mockedAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await queryAI('What meetings do I have today?', mockEvents);

    // Check that axios was called with the right data
    expect(mockedAxios.post).toHaveBeenCalledWith('/api/ai/query', {
      query: 'What meetings do I have today?',
      events: expect.arrayContaining([
        expect.objectContaining({
          id: '1',
          title: 'Team Meeting',
          start: expect.any(String),
          end: expect.any(String)
        })
      ])
    });

    // Check that the response is correctly processed
    expect(result).toEqual({
      answer: 'You have a team meeting at 10 AM and lunch with John at noon.',
      relatedEvents: [
        expect.objectContaining({
          id: '1',
          title: 'Team Meeting',
          start: expect.any(Date),
          end: expect.any(Date)
        })
      ]
    });

    // Verify the date objects are correctly constructed
    expect(result.relatedEvents?.[0].start).toBeInstanceOf(Date);
    expect(result.relatedEvents?.[0].end).toBeInstanceOf(Date);
  });

  test('handles API errors gracefully', async () => {
    // Mock API error
    mockedAxios.post.mockRejectedValueOnce(new Error('API Error'));

    const result = await queryAI('What meetings do I have today?', mockEvents);

    // Check that error was handled and appropriate message returned
    expect(result).toEqual({
      answer: "Sorry, I couldn't process your query. Please try again."
    });
    expect(console.error).toHaveBeenCalled();
  });

  test('handles response without relatedEvents', async () => {
    // Mock API response without relatedEvents
    const mockResponse = {
      data: {
        answer: 'You have no meetings with John.'
      }
    };

    mockedAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await queryAI('Do I have any meetings with John?', mockEvents);

    // Should not throw an error when relatedEvents is missing
    expect(result).toEqual({
      answer: 'You have no meetings with John.'
    });
  });

  test('handles invalid relatedEvents data', async () => {
    // Mock response with invalid relatedEvents (not an array)
    const mockResponse = {
      data: {
        answer: 'Answer text',
        relatedEvents: 'not an array'
      }
    };

    mockedAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await queryAI('Test query', mockEvents);

    // Should still return the answer without error
    expect(result).toEqual({
      answer: 'Answer text',
      relatedEvents: 'not an array'
    });
  });

  test('serializes date objects correctly', async () => {
    mockedAxios.post.mockImplementationOnce((url, data) => {
      // Check that Date objects are converted to ISO strings in the request
      const events = data.events;
      const isAllDatesStrings = events.every((e: any) => 
        typeof e.start === 'string' && 
        typeof e.end === 'string'
      );
      
      expect(isAllDatesStrings).toBe(true);
      
      // Return a simple response
      return Promise.resolve({
        data: {
          answer: 'Test answer',
          relatedEvents: []
        }
      });
    });

    await queryAI('Test query', mockEvents);
    
    // Verification is done in the mock implementation
    expect(mockedAxios.post).toHaveBeenCalled();
  });
}); 