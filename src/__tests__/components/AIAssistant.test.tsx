import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIAssistant from '@/components/AIAssistant';
import { queryAI } from '@/services/ai-service';

// Mock AI service
jest.mock('@/services/ai-service', () => ({
  queryAI: jest.fn()
}));

describe('AIAssistant Component', () => {
  // Sample calendar events for testing
  const mockEvents = [
    {
      id: '1',
      title: 'Team Meeting',
      start: new Date('2023-06-15T10:00:00'),
      end: new Date('2023-06-15T11:00:00'),
      location: 'Conference Room A',
      source: 'google' as const
    },
    {
      id: '2',
      title: 'Lunch with John',
      start: new Date('2023-06-15T12:00:00'),
      end: new Date('2023-06-15T13:00:00'),
      location: 'Cafeteria',
      source: 'microsoft' as const
    }
  ];

  // Mock for highlighting events
  const mockHighlightEvents = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (queryAI as jest.Mock).mockResolvedValue({
      answer: 'This is a test answer from AI',
      relatedEvents: [mockEvents[0]]
    });
  });

  test('renders in collapsed state initially', () => {
    render(<AIAssistant events={mockEvents} />);
    
    // Should show the open button but not the full assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    expect(openButton).toBeInTheDocument();
    
    // Full assistant should not be visible
    expect(screen.queryByText(/calendar assistant/i)).not.toBeInTheDocument();
  });

  test('expands when open button is clicked', async () => {
    render(<AIAssistant events={mockEvents} />);
    
    // Click the open button
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Full assistant should now be visible
    await waitFor(() => {
      expect(screen.getByText(/calendar assistant/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/ask about your meetings/i)).toBeInTheDocument();
    });
  });

  test('collapses when close button is clicked', async () => {
    render(<AIAssistant events={mockEvents} />);
    
    // First open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Now click the close button
    const closeButton = screen.getByRole('button', { name: /close assistant/i });
    fireEvent.click(closeButton);
    
    // Assistant should be collapsed again
    await waitFor(() => {
      expect(screen.queryByText(/calendar assistant/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /open ai assistant/i })).toBeInTheDocument();
    });
  });

  test('shows sample queries when opened', async () => {
    render(<AIAssistant events={mockEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Check for sample queries
    await waitFor(() => {
      expect(screen.getByText(/what meetings do i have today/i)).toBeInTheDocument();
      expect(screen.getByText(/when is my next meeting/i)).toBeInTheDocument();
    });
  });

  test('fills input field when sample query is clicked', async () => {
    render(<AIAssistant events={mockEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Click a sample query
    const sampleQuery = screen.getByText(/what meetings do i have today/i);
    fireEvent.click(sampleQuery);
    
    // Input should be filled with the sample query
    const inputField = screen.getByPlaceholderText(/ask about your meetings/i);
    expect(inputField).toHaveValue('What meetings do I have today?');
  });

  test('submit button is disabled when input is empty', async () => {
    render(<AIAssistant events={mockEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Find submit button - use a more specific selector since there are multiple buttons
    const form = screen.getByPlaceholderText(/ask about your meetings/i).closest('form');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    expect(submitButton).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    
    // Type something in the input
    const inputField = screen.getByPlaceholderText(/ask about your meetings/i);
    await userEvent.type(inputField, 'Test query');
    
    // Submit button should now be enabled
    expect(submitButton).not.toBeDisabled();
  });

  test('submits query and displays AI response', async () => {
    render(<AIAssistant events={mockEvents} onHighlightEvents={mockHighlightEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Type a query and submit
    const inputField = screen.getByPlaceholderText(/ask about your meetings/i);
    await userEvent.type(inputField, 'When is my next meeting?');
    
    // Find and click submit button
    const form = screen.getByPlaceholderText(/ask about your meetings/i).closest('form');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    expect(submitButton).toBeInTheDocument();
    fireEvent.click(submitButton as HTMLElement);
    
    // Check for loading indicator by looking for the div with animate-spin class
    await waitFor(() => {
      const loadingSpinner = document.querySelector('.animate-spin');
      expect(loadingSpinner).toBeInTheDocument();
    });
    
    // Wait for the AI response
    await waitFor(() => {
      expect(screen.getByText('This is a test answer from AI')).toBeInTheDocument();
    });
    
    // Check that the AI service was called with the right parameters
    expect(queryAI).toHaveBeenCalledWith('When is my next meeting?', mockEvents);
    
    // Verify the highlight events callback was called
    expect(mockHighlightEvents).toHaveBeenCalledWith([mockEvents[0]]);
  });

  test('handles AI service error gracefully', async () => {
    // Mock AI service failure
    (queryAI as jest.Mock).mockRejectedValue(new Error('API Error'));
    
    render(<AIAssistant events={mockEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Type a query and submit
    const inputField = screen.getByPlaceholderText(/ask about your meetings/i);
    await userEvent.type(inputField, 'Test query');
    
    // Find and click submit button
    const form = screen.getByPlaceholderText(/ask about your meetings/i).closest('form');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    expect(submitButton).toBeInTheDocument();
    fireEvent.click(submitButton as HTMLElement);
    
    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText(/sorry, i encountered an error/i)).toBeInTheDocument();
    });
  });

  test('disables input during query processing', async () => {
    // Make the AI service response delay a bit
    (queryAI as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            answer: 'Delayed response',
            relatedEvents: []
          });
        }, 100);
      });
    });
    
    render(<AIAssistant events={mockEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Type a query and submit
    const inputField = screen.getByPlaceholderText(/ask about your meetings/i);
    await userEvent.type(inputField, 'Test query');
    
    // Find and click submit button
    const form = screen.getByPlaceholderText(/ask about your meetings/i).closest('form');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    expect(submitButton).toBeInTheDocument();
    fireEvent.click(submitButton as HTMLElement);
    
    // Input and button should be disabled during processing
    expect(inputField).toBeDisabled();
    expect(submitButton).toBeDisabled();
    
    // Wait for response to complete
    await waitFor(() => {
      expect(screen.getByText('Delayed response')).toBeInTheDocument();
    });
    
    // Input should be enabled again
    expect(inputField).not.toBeDisabled();
  });

  test('works correctly without onHighlightEvents prop', async () => {
    // Render without the highlight callback
    render(<AIAssistant events={mockEvents} />);
    
    // Open the assistant
    const openButton = screen.getByRole('button', { name: /open ai assistant/i });
    fireEvent.click(openButton);
    
    // Type a query and submit
    const inputField = screen.getByPlaceholderText(/ask about your meetings/i);
    await userEvent.type(inputField, 'Test query');
    
    // Find and click submit button
    const form = screen.getByPlaceholderText(/ask about your meetings/i).closest('form');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    expect(submitButton).toBeInTheDocument();
    fireEvent.click(submitButton as HTMLElement);
    
    // Wait for the AI response
    await waitFor(() => {
      expect(screen.getByText('This is a test answer from AI')).toBeInTheDocument();
    });
    
    // No error should occur even though onHighlightEvents wasn't provided
    expect(queryAI).toHaveBeenCalledWith('Test query', mockEvents);
  });
}); 