
import React, { useState } from "react";

import '../app/index.css'
import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { PageHeader } from "@/components/PageHeader";
import { Credential } from "@/components/Credential";


export default function App() {
    const app = useMountedApp();
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefreshCredentials = async () => {
        if (!app.db.instance) {
            console.error('❌ Database not connected - cannot refresh credentials');
            return;
        }

        console.log('🔄 Starting manual credential refresh...');
        setIsRefreshing(true);

        try {
            await app.refreshCredentials();
            console.log('✅ Manual credential refresh completed');
        } catch (error) {
            console.error('❌ Manual credential refresh failed:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <>
            <div className="mx-10 mt-5 mb-30">
                <PageHeader>
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
                        Credentials
                    </h1>
                </PageHeader>
                <DBConnect>
                    <Box>
                        {/* Refresh Button */}
                        <div className="mb-6">
                            <button
                                onClick={handleRefreshCredentials}
                                disabled={isRefreshing || !app.db.instance}
                                className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                                    isRefreshing || !app.db.instance
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                            >
                                {isRefreshing ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Refreshing...
                                    </>
                                ) : (
                                    <>
                                        🔄 Refresh Credentials
                                    </>
                                )}
                            </button>
                            <p className="mt-2 text-sm text-gray-500">
                                Click to manually refresh credentials from database
                            </p>
                        </div>

                        {/* Credentials List */}
                        {
                            app.credentials.length <= 0 ?
                                <div className="text-center py-8">
                                    <p className="text-lg font-normal text-gray-500 lg:text-xl dark:text-gray-400">
                                        No credentials found.
                                    </p>
                                    <p className="text-sm text-gray-400 mt-2">
                                        If you have accepted credential offers, try clicking "Refresh Credentials" above.
                                    </p>
                                </div>
                                :
                                app.credentials.map((credential, i) => {
                                    return (
                                        <div key={`credential${credential.id}${i}`} className="mb-6 p-4 border border-gray-200 rounded-lg shadow-sm">
                                            <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-3">
                                                🎫 Credential ({credential.credentialType})
                                            </p>
                                            <Credential credential={credential} />
                                        </div>
                                    )
                                })
                        }
                    </Box>
                </DBConnect>
            </div>
        </>
    );
}