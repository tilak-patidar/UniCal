"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { NewCalendarEvent, createCalendarEvent } from "@/services/calendar-service";
import { format } from "date-fns";
import { XMarkIcon, CalendarIcon, ClockIcon, MapPinIcon, UserGroupIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

interface CreateMeetingFormProps {
  isOpen: boolean;
  onClose: () => void;
  onEventCreated: (event: any) => void;
  initialDate?: Date;
}

// Helper function to round to nearest 15 minutes
const roundToNearest15Min = (date: Date): Date => {
  const minutes = date.getMinutes();
  const remainder = minutes % 15;
  if (remainder === 0) return date;
  
  const minutesToAdd = 15 - remainder;
  const rounded = new Date(date);
  rounded.setMinutes(minutes + minutesToAdd, 0, 0);
  return rounded;
};

export default function CreateMeetingForm({ 
  isOpen, 
  onClose, 
  onEventCreated,
  initialDate = new Date()
}: CreateMeetingFormProps) {
  const { data: session } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>("azure-ad"); // Default to Microsoft
  
  // Round initialDate to nearest 15 minutes
  const roundedInitialDate = roundToNearest15Min(initialDate);
  const roundedEndDate = new Date(roundedInitialDate);
  roundedEndDate.setHours(roundedEndDate.getHours() + 1); // Add 1 hour
  
  // Form state
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(format(roundedInitialDate, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(roundedInitialDate, "HH:mm"));
  const [endDate, setEndDate] = useState(format(roundedEndDate, "yyyy-MM-dd"));
  const [endTime, setEndTime] = useState(format(roundedEndDate, "HH:mm"));
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isOnlineMeeting, setIsOnlineMeeting] = useState(true);
  const [attendees, setAttendees] = useState("");
  
  // Reset form to initial values
  const resetForm = () => {
    // Recalculate time boundaries because time may have passed
    const newRoundedDate = roundToNearest15Min(new Date());
    const newEndDate = new Date(newRoundedDate);
    newEndDate.setHours(newEndDate.getHours() + 1);
    
    setTitle("");
    setStartDate(format(newRoundedDate, "yyyy-MM-dd"));
    setStartTime(format(newRoundedDate, "HH:mm"));
    setEndDate(format(newEndDate, "yyyy-MM-dd"));
    setEndTime(format(newEndDate, "HH:mm"));
    setLocation("");
    setDescription("");
    setIsOnlineMeeting(true);
    setAttendees("");
  };
  
  // Initialize available providers when session is loaded
  useEffect(() => {
    if (!session) return;
    
    const providers: string[] = [];
    
    // Add current session provider
    if (session.provider) {
      providers.push(session.provider);
    }
    
    // Check for stored providers from localStorage
    const storedProviders = localStorage.getItem("connectedProviders");
    if (storedProviders) {
      try {
        const parsedProviders = JSON.parse(storedProviders) as string[];
        parsedProviders.forEach(provider => {
          if (!providers.includes(provider)) {
            providers.push(provider);
          }
        });
      } catch (e) {
        console.error("Error parsing stored providers", e);
      }
    }
    
    setAvailableProviders(providers);
    
    // Prefer Microsoft (azure-ad), then Google, then whatever's available
    if (providers.includes("azure-ad")) {
      setSelectedProvider("azure-ad");
    } else if (providers.includes("google")) {
      setSelectedProvider("google");
    } else if (providers.length > 0) {
      setSelectedProvider(providers[0]);
    }
  }, [session]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedProvider || !session?.accessToken) {
      setError("No calendar provider selected or not authenticated");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Parse dates and times
      const startDateTime = new Date(`${startDate}T${startTime}`);
      const endDateTime = new Date(`${endDate}T${endTime}`);
      
      // Validate dates
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        throw new Error("Invalid date or time format");
      }
      
      if (endDateTime <= startDateTime) {
        throw new Error("End time must be after start time");
      }
      
      // Parse attendees
      const attendeesList = attendees.split(",")
        .map(email => email.trim())
        .filter(email => email.length > 0);
      
      // Prepare the event object
      const newEvent: NewCalendarEvent = {
        title,
        start: startDateTime,
        end: endDateTime,
        location,
        description,
        isOnlineMeeting,
        attendees: attendeesList
      };
      
      // Determine which provider's token to use
      let accessToken = session.accessToken;
      
      if (selectedProvider === "google" && session.provider !== "google") {
        accessToken = localStorage.getItem("googleAccessToken") || "";
      } else if (selectedProvider === "azure-ad" && session.provider !== "azure-ad") {
        accessToken = localStorage.getItem("msAccessToken") || "";
      }
      
      if (!accessToken) {
        throw new Error(`No access token available for ${selectedProvider}`);
      }
      
      // Create the event
      const createdEvent = await createCalendarEvent(selectedProvider, accessToken, newEvent);
      
      if (!createdEvent) {
        throw new Error("Failed to create event");
      }
      
      // Reset form
      resetForm();
      
      // Call the success callback
      onEventCreated(createdEvent);
      
      // Close the form
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      console.error("Error creating meeting:", err);
    } finally {
      setIsLoading(false);
    }
  };
  
  if (!isOpen) return null;
  
  // Handler for clicking on the backdrop
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if the click is directly on the backdrop (not on the modal)
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
  
  return (
    <div 
      className="fixed inset-0 z-50 overflow-auto bg-black/40 backdrop-blur-sm flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Create New Meeting</h2>
          <button 
            onClick={onClose}
            className="text-white hover:bg-indigo-700 p-1 rounded-full transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        
        {/* Form content */}
        <div className="p-6 bg-white">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-5">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Calendar Provider
              </label>
              <div className="relative">
                <select
                  value={selectedProvider || ""}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="block w-full pl-3 pr-10 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900 appearance-none"
                  required
                >
                  <option value="">Select a provider</option>
                  {availableProviders.map(provider => (
                    <option key={provider} value={provider}>
                      {provider === "google" ? "Google Calendar" : "Microsoft Calendar"}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2">
                  <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 20 20" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 7l3-3 3 3m0 6l-3 3-3-3" />
                  </svg>
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Meeting Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="block w-full px-4 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-500"
                placeholder="Enter meeting title"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">
                  Start Date
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <CalendarIcon className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">
                  Start Time
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <ClockIcon className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900"
                    required
                  />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">
                  End Date
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <CalendarIcon className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">
                  End Time
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <ClockIcon className="h-5 w-5 text-gray-500" />
                  </div>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900"
                    required
                  />
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Location (optional)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MapPinIcon className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-500"
                  placeholder="Enter location or leave blank"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Description (optional)
              </label>
              <div className="relative">
                <div className="absolute top-3 left-3 flex items-start pointer-events-none">
                  <DocumentTextIcon className="h-5 w-5 text-gray-500" />
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-500"
                  rows={3}
                  placeholder="Add meeting description"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                Attendees (comma-separated emails, optional)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserGroupIcon className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  type="text"
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="email1@example.com, email2@example.com"
                  className="block w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900 placeholder-gray-500"
                />
              </div>
            </div>
            
            <div className="flex items-center">
              <input
                type="checkbox"
                id="isOnlineMeeting"
                checked={isOnlineMeeting}
                onChange={(e) => setIsOnlineMeeting(e.target.checked)}
                className="h-5 w-5 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              />
              <label htmlFor="isOnlineMeeting" className="ml-2 block text-sm font-medium text-gray-800">
                Create as online meeting
              </label>
            </div>
            
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <div className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </div>
                ) : "Create Meeting"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
} 