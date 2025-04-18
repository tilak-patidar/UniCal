"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { Fragment, useState, useEffect } from "react";
import { Menu, Transition } from "@headlessui/react";
import { UserIcon } from "@heroicons/react/24/outline";
import Image from "next/image";

export default function Header() {
  const { data: session, status } = useSession();
  const [connectedProviders, setConnectedProviders] = useState<string[]>(
    session?.provider ? [session.provider] : []
  );

  // Track when a provider is being connected
  const [isConnecting, setIsConnecting] = useState(false);

  // Function to link a new provider without signing out
  const handleConnectProvider = async (provider: string) => {
    if (!session || connectedProviders.includes(provider)) return;
    
    setIsConnecting(true);
    
    // We'll use localStorage to store our current provider before connecting a new one
    localStorage.setItem("currentProvider", session.provider || "");
    localStorage.setItem("currentAccessToken", session.accessToken || "");
    localStorage.setItem("currentRefreshToken", session.refreshToken || "");
    
    // Store current connected providers
    localStorage.setItem("connectedProviders", JSON.stringify(connectedProviders));
    
    // Connect the new provider
    await signIn(provider, { callbackUrl: "/" });
  };

  // Load previously connected providers from localStorage on component mount
  useEffect(() => {
    if (typeof window !== "undefined" && session) {
      const storedProviders = localStorage.getItem("connectedProviders");
      
      if (storedProviders) {
        try {
          const providers = JSON.parse(storedProviders);
          if (!providers.includes(session.provider) && session.provider) {
            // Add new provider to the list if it's not already there
            const updatedProviders = [...providers, session.provider];
            setConnectedProviders(updatedProviders);
            localStorage.setItem("connectedProviders", JSON.stringify(updatedProviders));
          } else {
            setConnectedProviders(providers);
          }
        } catch (e) {
          console.error("Error parsing stored providers", e);
        }
      } else if (session.provider) {
        setConnectedProviders([session.provider]);
        localStorage.setItem("connectedProviders", JSON.stringify([session.provider]));
      }
      
      setIsConnecting(false);
    }
  }, [session]);

  return (
    <header className="flex items-center justify-between p-4 border-b bg-white">
      <div className="flex items-center space-x-2">
        <h1 className="text-2xl font-bold text-indigo-700">UniCal</h1>
        <span className="text-sm text-gray-500">Your Unified Calendar</span>
      </div>

      <div className="flex items-center space-x-4">
        {status === "authenticated" && (
          <div className="flex space-x-2">
            <button
              onClick={() => handleConnectProvider("google")}
              className={`px-3 py-1 text-sm rounded-md ${
                connectedProviders.includes("google")
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-blue-50 text-blue-600 hover:bg-blue-100"
              }`}
              disabled={connectedProviders.includes("google") || isConnecting}
            >
              {connectedProviders.includes("google") ? "Google Connected" : "Connect Google"}
            </button>
            <button
              onClick={() => handleConnectProvider("azure-ad")}
              className={`px-3 py-1 text-sm rounded-md ${
                connectedProviders.includes("azure-ad")
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-blue-50 text-blue-600 hover:bg-blue-100"
              }`}
              disabled={connectedProviders.includes("azure-ad") || isConnecting}
            >
              {connectedProviders.includes("azure-ad") ? "Microsoft Connected" : "Connect Microsoft"}
            </button>
          </div>
        )}

        {status === "authenticated" ? (
          <Menu as="div" className="relative inline-block text-left">
            <div>
              <Menu.Button className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200">
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt={session.user.name || "User"}
                    className="rounded-full"
                    width={32}
                    height={32}
                  />
                ) : (
                  <UserIcon className="w-5 h-5 text-gray-700" />
                )}
              </Menu.Button>
            </div>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right bg-white divide-y divide-gray-100 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                <div className="px-4 py-3">
                  <p className="text-sm">Signed in as</p>
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {session.user?.email}
                  </p>
                </div>
                <div className="py-1">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => signOut({ callbackUrl: "/" })}
                        className={`${
                          active ? "bg-gray-100 text-gray-900" : "text-gray-700"
                        } flex w-full px-4 py-2 text-sm`}
                      >
                        Sign out
                      </button>
                    )}
                  </Menu.Item>
                </div>
              </Menu.Items>
            </Transition>
          </Menu>
        ) : (
          <button
            onClick={() => signIn()}
            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
} 