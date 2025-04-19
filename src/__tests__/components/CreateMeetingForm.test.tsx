import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import CreateMeetingForm from '@/components/CreateMeetingForm';
import { createCalendarEvent } from '@/services/calendar-service';
import { format } from 'date-fns';

// Mocking modules
jest.mock('next-auth/react');
jest.mock('@/services/calendar-service', () => ({
  createCalendarEvent: jest.fn()
}));

// Mock implementation for useSession
const mockUseSession = useSession as jest.Mock;

describe('CreateMeetingForm Component', () => {
  // Mock date for consistent testing
  const mockDate = new Date('2023-10-15T14:20:00');
  const mockExpires = '2023-12-31T23:59:59Z'; // Fixed expiry string for session
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock localStorage
    const localStorageMock = {
      getItem: jest.fn().mockImplementation((key) => {
        if (key === 'connectedProviders') {
          return JSON.stringify(['google', 'azure-ad']);
        }
        return null;
      }),
      setItem: jest.fn(),
      clear: jest.fn(),
      removeItem: jest.fn(),
      length: 0,
      key: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    
    // Mock Date.now for consistent test results
    jest.spyOn(Date, 'now').mockImplementation(() => mockDate.getTime());
    
    // Mock session data
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        accessToken: 'test-token',
        provider: 'azure-ad',
        expires: mockExpires
      },
      status: 'authenticated'
    });
    
    // Mock createCalendarEvent to return success
    (createCalendarEvent as jest.Mock).mockResolvedValue({
      id: 'new-event-id',
      title: 'Test Meeting',
      start: new Date('2023-10-15T15:00:00'),
      end: new Date('2023-10-15T16:00:00')
    });
  });
  
  afterEach(() => {
    jest.resetAllMocks();
  });
  
  // Helper function to render the component
  const renderComponent = (props = {}) => {
    const defaultProps = {
      isOpen: true,
      onClose: jest.fn(),
      onEventCreated: jest.fn(),
      initialDate: mockDate
    };
    
    return render(<CreateMeetingForm {...defaultProps} {...props} />);
  };
  
  test('renders correctly when open', () => {
    renderComponent();
    
    expect(screen.getByText('Create New Meeting')).toBeInTheDocument();
    expect(screen.getByText('Calendar Provider')).toBeInTheDocument();
    expect(screen.getByText('Meeting Title')).toBeInTheDocument();
    expect(screen.getByText('Start Date')).toBeInTheDocument();
    expect(screen.getByText('End Date')).toBeInTheDocument();
  });
  
  test('does not render when isOpen is false', () => {
    renderComponent({ isOpen: false });
    
    expect(screen.queryByText('Create New Meeting')).not.toBeInTheDocument();
  });
  
  test('selects Microsoft Calendar by default', () => {
    // Setup with both providers available
    const localStorageMock = {
      getItem: jest.fn().mockImplementation((key) => {
        if (key === 'connectedProviders') {
          return JSON.stringify(['google', 'azure-ad']);
        }
        return null;
      })
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    
    renderComponent();
    
    // Verify Microsoft is selected by default
    const selectElement = screen.getByRole('combobox');
    expect(selectElement).toHaveValue('azure-ad');
  });
  
  test('falls back to Google Calendar when Microsoft is not available', () => {
    // Mock localStorage to include only Google
    const localStorageMock = {
      getItem: jest.fn().mockImplementation((key) => {
        if (key === 'connectedProviders') {
          return JSON.stringify(['google']); // Only Google is available
        }
        return null;
      }),
      setItem: jest.fn(),
      clear: jest.fn(),
      removeItem: jest.fn(),
      length: 0,
      key: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    
    // Mock session data with Google as the provider
    mockUseSession.mockReturnValue({
      data: {
        user: { name: 'Test User', email: 'test@example.com' },
        accessToken: 'test-token',
        provider: 'google',
        expires: mockExpires
      },
      status: 'authenticated'
    });
    
    renderComponent();
    
    // Since Microsoft is not available, Google should be selected
    const selectElement = screen.getByRole('combobox');
    expect(selectElement).toHaveValue('google');
  });
  
  test('sets default start time to next 15 minute interval', () => {
    // Mock date is 2023-10-15T14:20:00, so next 15-min interval is 14:30
    renderComponent();
    
    const expectedStartTime = '14:30';
    const expectedEndTime = '15:30'; // 1 hour after start
    
    // Get time inputs by type
    const timeInputs = screen.getAllByDisplayValue(/:/).filter(el => 
      el.getAttribute('type') === 'time'
    );
    
    expect(timeInputs.length).toBe(2);
    expect(timeInputs[0]).toHaveValue(expectedStartTime); // Start time
    expect(timeInputs[1]).toHaveValue(expectedEndTime);  // End time
  });
  
  test('closes when clicking outside the modal', () => {
    const onCloseMock = jest.fn();
    renderComponent({ onClose: onCloseMock });
    
    // Find modal backdrop and click it
    const backdrop = document.querySelector('.fixed.inset-0');
    fireEvent.click(backdrop!);
    
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });
  
  test('does not close when clicking inside the modal', () => {
    const onCloseMock = jest.fn();
    renderComponent({ onClose: onCloseMock });
    
    // Click on the form element
    fireEvent.click(screen.getByText('Meeting Title'));
    
    expect(onCloseMock).not.toHaveBeenCalled();
  });
  
  test('successfully submits form and creates event', async () => {
    const onEventCreatedMock = jest.fn();
    const onCloseMock = jest.fn();
    
    renderComponent({
      onEventCreated: onEventCreatedMock,
      onClose: onCloseMock
    });
    
    // Fill out the form
    fireEvent.change(screen.getByPlaceholderText('Enter meeting title'), {
      target: { value: 'Test Meeting' }
    });
    
    // Submit the form
    fireEvent.click(screen.getByText('Create Meeting'));
    
    await waitFor(() => {
      expect(createCalendarEvent).toHaveBeenCalledWith(
        'azure-ad',
        'test-token',
        expect.objectContaining({
          title: 'Test Meeting',
          isOnlineMeeting: true
        })
      );
      expect(onEventCreatedMock).toHaveBeenCalled();
      expect(onCloseMock).toHaveBeenCalled();
    });
  });
  
  test('shows error message when form submission fails', async () => {
    (createCalendarEvent as jest.Mock).mockRejectedValue(new Error('API Error'));
    
    renderComponent();
    
    // Fill out the form
    fireEvent.change(screen.getByPlaceholderText('Enter meeting title'), {
      target: { value: 'Test Meeting' }
    });
    
    // Submit the form
    fireEvent.click(screen.getByText('Create Meeting'));
    
    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });
  });
  
  test('resets form fields after successful submission', async () => {
    const onEventCreatedMock = jest.fn();
    const onCloseMock = jest.fn();
    onCloseMock.mockImplementation(() => {
      // Don't actually close, so we can verify fields are reset
      return false;
    });
    
    renderComponent({
      onEventCreated: onEventCreatedMock,
      onClose: onCloseMock
    });
    
    // Fill out the form
    const titleInput = screen.getByPlaceholderText('Enter meeting title');
    fireEvent.change(titleInput, {
      target: { value: 'Test Meeting' }
    });
    
    const locationInput = screen.getByPlaceholderText('Enter location or leave blank');
    fireEvent.change(locationInput, {
      target: { value: 'Test Location' }
    });
    
    // Submit the form but prevent close
    await act(async () => {
      fireEvent.click(screen.getByText('Create Meeting'));
    });
    
    // Wait for the submission to complete
    await waitFor(() => {
      expect(createCalendarEvent).toHaveBeenCalled();
    });
    
    // Form should reset - mock implementation prevents actual close
    // But the title and location should be reset
    expect(titleInput).toHaveValue('');
    expect(locationInput).toHaveValue('');
  });
  
  test('shows loading state during form submission', async () => {
    // Mock a delayed response
    (createCalendarEvent as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => setTimeout(() => {
        resolve({
          id: 'new-event-id',
          title: 'Test Meeting'
        });
      }, 100));
    });
    
    renderComponent();
    
    // Fill out the form
    fireEvent.change(screen.getByPlaceholderText('Enter meeting title'), {
      target: { value: 'Test Meeting' }
    });
    
    // Submit the form
    fireEvent.click(screen.getByText('Create Meeting'));
    
    // Should show loading indicator
    expect(screen.getByText('Creating...')).toBeInTheDocument();
    
    // Wait for submission to complete
    await waitFor(() => {
      expect(createCalendarEvent).toHaveBeenCalled();
    });
  });
  
  test('validates that end time is after start time', async () => {
    renderComponent();
    
    // Fill out the form with invalid dates (end before start)
    fireEvent.change(screen.getByPlaceholderText('Enter meeting title'), {
      target: { value: 'Test Meeting' }
    });
    
    // Get date and time inputs
    const dateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    const timeInputs = screen.getAllByDisplayValue(/:/);
    
    // Assuming first date input is start date, second is end date
    const startDateInput = dateInputs[0];
    const endDateInput = dateInputs[1];
    
    // Assuming first time input is start time, second is end time
    const startTimeInput = timeInputs[0];
    const endTimeInput = timeInputs[1];
    
    // Set end time before start time (same date)
    fireEvent.change(startTimeInput, { target: { value: '14:30' } });
    fireEvent.change(endTimeInput, { target: { value: '14:00' } });
    
    // Submit the form
    fireEvent.click(screen.getByText('Create Meeting'));
    
    await waitFor(() => {
      expect(screen.getByText('End time must be after start time')).toBeInTheDocument();
      expect(createCalendarEvent).not.toHaveBeenCalled();
    });
  });
  
  test('online meeting checkbox is checked by default', () => {
    renderComponent();
    
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });
  
  test('toggles online meeting checkbox correctly', () => {
    renderComponent();
    
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked(); // Default is checked
    
    // Toggle checkbox to unchecked
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    
    // Toggle back to checked
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
  
  test('includes online meeting value in form submission', async () => {
    renderComponent();
    
    // Fill out the form
    fireEvent.change(screen.getByPlaceholderText('Enter meeting title'), {
      target: { value: 'Test Meeting' }
    });
    
    // Find and uncheck the online meeting checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox); // Uncheck
    expect(checkbox).not.toBeChecked();
    
    // Submit the form
    fireEvent.click(screen.getByText('Create Meeting'));
    
    // Verify form was submitted with isOnlineMeeting: false
    await waitFor(() => {
      expect(createCalendarEvent).toHaveBeenCalledWith(
        'azure-ad',
        'test-token',
        expect.objectContaining({
          title: 'Test Meeting',
          isOnlineMeeting: false // Should be false because we unchecked it
        })
      );
    });
  });
}); 