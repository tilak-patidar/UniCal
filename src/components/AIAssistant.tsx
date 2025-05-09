"use client";

import { useState, useRef, useEffect } from 'react';
import { CalendarEvent } from '@/services/calendar-service';
import { queryAI, AIQueryResponse } from '@/services/ai-service';
import Image from 'next/image';

interface AIAssistantProps {
  events: CalendarEvent[];
  onHighlightEvents?: (events: CalendarEvent[]) => void;
}

export default function AIAssistant({ events, onHighlightEvents }: AIAssistantProps) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input field when the assistant is opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle query submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) return;
    
    setIsLoading(true);
    setAnswer(null);
    
    try {
      const response = await queryAI(query, events);
      setAnswer(response.answer);
      
      // If there are related events, highlight them
      if (response.relatedEvents && onHighlightEvents) {
        onHighlightEvents(response.relatedEvents);
      }
    } catch (error) {
      console.error('Error querying AI:', error);
      setAnswer('Sorry, I encountered an error processing your query.');
    } finally {
      setIsLoading(false);
      // Reset the query input field after submission
      setQuery('');
    }
  };

  // Sample queries to help users get started
  const sampleQueries = [
    "What meetings do I have today?",
    "When is my next meeting?",
    "Do I have any meetings with John?",
    "When am I free today?",
    "What meetings do I have tomorrow?"
  ];

  const handleSampleQuery = async (sample: string) => {
    setQuery(sample);
    
    // Automatically submit the sample query
    setIsLoading(true);
    setAnswer(null);
    
    try {
      const response = await queryAI(sample, events);
      setAnswer(response.answer);
      
      // If there are related events, highlight them
      if (response.relatedEvents && onHighlightEvents) {
        onHighlightEvents(response.relatedEvents);
      }
    } catch (error) {
      console.error('Error querying AI:', error);
      setAnswer('Sorry, I encountered an error processing your query.');
    } finally {
      setIsLoading(false);
      // Reset the query input field after processing
      setQuery('');
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Collapsed state - just the button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-full shadow-lg flex items-center justify-center"
          aria-label="Open Calendar Assistant"
        >
          <Image 
            src="/chat-bot.svg" 
            alt="Calendar Assistant" 
            width={24} 
            height={24}
          />
        </button>
      )}

      {/* Expanded state - full assistant UI */}
      {isOpen && (
        <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-80 md:w-96 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-indigo-600 text-white p-3 flex justify-between items-center">
            <div className="flex items-center">
              <Image 
                src="/chat-bot.svg" 
                alt="Calendar Assistant" 
                width={20} 
                height={20} 
                className="mr-2"
              />
              <h3 className="font-medium">Calendar Assistant</h3>
            </div>
            <button 
              onClick={() => setIsOpen(false)} 
              className="text-white hover:text-gray-200"
              aria-label="Close Assistant"
            >
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className="h-5 w-5" 
                viewBox="0 0 20 20" 
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Answer display area */}
          <div className="p-3 bg-gray-50 flex-grow max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-indigo-500"></div>
              </div>
            ) : answer ? (
              <div className="text-sm text-gray-800 space-y-1 leading-5">
                {answer.split('\n\n').map((paragraph, i) => (
                  <div key={i} className="mb-1.5">
                    {paragraph.split('\n').map((line, j) => {
                      // Handle bullet points with special formatting
                      if (line.startsWith('•')) {
                        // Match the pattern: • **Title** from Time to Time
                        const meetingMatch = line.match(/^•\s*\*\*(.*?)\*\*\s*(from.*)/);
                        
                        if (meetingMatch) {
                          const [_, title, timeInfo] = meetingMatch;
                          return (
                            <div key={j} className="pl-3 flex items-start mb-1">
                              <span className="inline-block w-3 flex-shrink-0 text-indigo-600">•</span>
                              <div className="ml-1">
                                <strong className="font-semibold text-gray-900 block">{title}</strong>
                                <span className="text-gray-600 whitespace-pre-wrap">{timeInfo}</span>
                              </div>
                            </div>
                          );
                        } else {
                          // Default bullet point handling for other formats
                          return (
                            <div key={j} className="pl-3 flex items-start mb-1">
                              <span className="inline-block w-3 flex-shrink-0 text-indigo-600">•</span>
                              <span 
                                className="ml-1 whitespace-pre-wrap"
                                dangerouslySetInnerHTML={{
                                  __html: line.substring(1).replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
                                }} 
                              />
                            </div>
                          );
                        }
                      } else {
                        // Regular line handling (not a bullet point)
                        return (
                          <div key={j} className="mb-0.5">
                            <span 
                              className={`${line.startsWith('**') ? 'font-medium text-gray-900' : ''} whitespace-pre-wrap`}
                              dangerouslySetInnerHTML={{
                                __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
                              }}
                            />
                          </div>
                        );
                      }
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-500 h-full flex flex-col justify-center">
                <p className="text-center mb-4">Ask me anything about your calendar!</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {sampleQueries.map((sample, index) => (
                    <button
                      key={index}
                      onClick={() => handleSampleQuery(sample)}
                      className="bg-white border border-indigo-300 rounded-full px-3 py-1.5 text-sm text-indigo-700 
                      hover:bg-indigo-100 transition-colors shadow-sm font-medium cursor-pointer flex items-center"
                    >
                      <svg className="w-3.5 h-3.5 mr-1.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200">
            <div className="flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about your meetings..."
                className="flex-grow px-3 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 font-medium"
                disabled={isLoading}
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-r-lg disabled:opacity-50"
                disabled={isLoading || !query.trim()}
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor" 
                  className="w-5 h-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
} 