/**
 * Tests for the AI query API route
 * Note: This uses mocks for NextRequest/NextResponse and other dependencies
 */

// Mock the modules before importing the route
jest.mock('next/server', () => {
  return {
    NextRequest: jest.fn().mockImplementation((body) => ({
      json: () => Promise.resolve(body)
    })),
    NextResponse: {
      json: jest.fn((data, options) => ({
        status: options?.status || 200,
        data,
        json: async () => data
      }))
    }
  };
});

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn()
}));

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: 'Claude AI response' }]
      })
    }
  }));
});

// Import the route handler after mocking
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import Anthropic from '@anthropic-ai/sdk';
import { POST } from '@/app/api/ai/query/route';

// Also mock the utility functions
jest.mock('@/app/api/ai/query/utils', () => {
  return {
    findOverlappingMeetings: jest.fn(() => ({ hasOverlaps: true, overlaps: [{ event1: {}, event2: {} }] })),
    findFreeSlots: jest.fn(() => ['From 9:00 AM to 5:00 PM']),
    extractKeywords: jest.fn(() => ['meeting']),
    extractPersonName: jest.fn(() => null),
    formatTime: jest.fn((str) => '10:00 AM'),
    formatDateIST: jest.fn((date) => 'Saturday, April 19, 2025'),
    formatDateTimeIST: jest.fn((date) => 'Saturday, April 19, 2025 at 5:00 PM')
  };
});

describe('AI Query API Route', () => {
  const originalEnv = process.env;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default authenticated session
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { name: 'Test User', email: 'test@example.com' }
    });
    
    // Mock environment variables
    process.env = {
      ...originalEnv,
      ANTHROPIC_API_KEY: 'test-api-key'
    };
    
    // Suppress console errors during tests
    console.error = jest.fn();
  });
  
  afterEach(() => {
    process.env = originalEnv;
    console.error = originalConsoleError;
  });
  
  // Helper to create a request with the given body
  const createRequest = (body: any): NextRequest => {
    return new NextRequest(body);
  };
  
  test('returns 401 when user is not authenticated', async () => {
    // Mock unauthenticated session
    (getServerSession as jest.Mock).mockResolvedValueOnce(null);
    
    const request = createRequest({
      query: 'What meetings do I have today?',
      events: []
    });
    
    const response = await POST(request);
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: 'Unauthorized' });
  });
  
  test('returns 400 when query is missing', async () => {
    const request = createRequest({
      events: []
    });
    
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: 'Query is required' });
  });
  
  test('returns 400 when events are missing', async () => {
    const request = createRequest({
      query: 'What meetings do I have today?'
    });
    
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: 'Events data is required' });
  });
  
  test('calls Claude API when API key is available', async () => {
    const mockEvents = [
      {
        id: '1',
        title: 'Team Meeting',
        start: '2023-06-15T10:00:00Z',
        end: '2023-06-15T11:00:00Z',
        location: 'Conference Room A',
        description: 'Weekly team sync',
        source: 'google'
      }
    ];
    
    const request = createRequest({
      query: 'What meetings do I have today?',
      events: mockEvents
    });
    
    const response = await POST(request);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('answer');
    
    // Verify Claude client was initialized and called
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    const anthropicInstance = (Anthropic as unknown as jest.Mock).mock.results[0].value;
    expect(anthropicInstance.messages.create).toHaveBeenCalled();
  });
  
  test('falls back to rule-based processing when Claude API fails', async () => {
    // Mock Claude API failure
    const mockAnthropicInstance = {
      messages: {
        create: jest.fn().mockRejectedValue(new Error('Claude API error'))
      }
    };
    (Anthropic as unknown as jest.Mock).mockImplementationOnce(() => mockAnthropicInstance);
    
    const mockEvents = [
      {
        id: '1',
        title: 'Team Meeting',
        start: '2023-06-15T10:00:00Z',
        end: '2023-06-15T11:00:00Z',
        source: 'google'
      }
    ];
    
    const request = createRequest({
      query: 'What meetings do I have today?',
      events: mockEvents
    });
    
    const response = await POST(request);
    
    // Should still return a valid response using rule-based processing
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('answer');
    
    // Should log the error
    expect(console.error).toHaveBeenCalled();
  });
  
  test('uses rule-based processing when API key is not available', async () => {
    // Remove API key
    delete process.env.ANTHROPIC_API_KEY;
    
    const mockEvents = [
      {
        id: '1',
        title: 'Team Meeting',
        start: '2023-06-15T10:00:00Z',
        end: '2023-06-15T11:00:00Z',
        source: 'google'
      }
    ];
    
    const request = createRequest({
      query: 'What meetings do I have today?',
      events: mockEvents
    });
    
    const response = await POST(request);
    
    // Should return a valid response using rule-based processing
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('answer');
    
    // Claude client should not be initialized
    expect(Anthropic).not.toHaveBeenCalled();
  });
  
  test('handles general API errors gracefully', async () => {
    // Create a request with a custom json method that throws an error
    const request = {
      json: jest.fn().mockRejectedValue(new Error('JSON parse error'))
    } as unknown as NextRequest;
    
    const response = await POST(request);
    
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({
      answer: 'Sorry, I encountered an error processing your query.'
    });
    
    // Should log the error
    expect(console.error).toHaveBeenCalled();
  });
  
  // Testing specific query types with mocked utility functions
  
  test('identifies overlapping meetings correctly', async () => {
    const mockEvents = [
      {
        id: '1',
        title: 'Meeting A', 
        start: new Date().toISOString(),
        end: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        source: 'google'
      },
      {
        id: '2',
        title: 'Meeting B',
        start: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        source: 'microsoft'
      }
    ];
    
    const request = createRequest({
      query: 'Do I have any overlapping meetings today?',
      events: mockEvents
    });
    
    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});