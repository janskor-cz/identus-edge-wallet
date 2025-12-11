import '../app/index.css'

import React, { useEffect } from "react";
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { FooterNavigation } from "@/components/FooterNavigation";

import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { OOB } from "@/components/OOB";
import { PageHeader } from "@/components/PageHeader";

export default function App() {

    const app = useMountedApp();
    const [connections, setConnections] = React.useState<SDK.Domain.DIDPair[]>([]);

    useEffect(() => {
        setConnections(app.connections)
    }, [app.connections])

    return (
        <>
            <div className="mx-10 mt-5 mb-30">
                <PageHeader>
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
                        Connections
                    </h1>
                </PageHeader>
                <DBConnect>
                    <Box>
                        <OOB agent={app.agent.instance!} pluto={app.db.instance!} />
                        {
                            connections.length <= 0 ?
                                <p className=" text-lg font-normal text-gray-500 lg:text-xl  dark:text-gray-400">
                                    No connections.
                                </p>
                                :
                                null
                        }
                        {
                            connections.map((connection, i) => {
                                return <div key={`connection${i}`} className="my-5 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                        {connection.name || 'Unnamed Connection'}
                                    </h3>
                                    <div className="space-y-2">
                                        <div>
                                            <span className="font-medium text-gray-700 dark:text-gray-300">Host DID:</span>
                                            <p className="text-sm font-mono text-gray-600 dark:text-gray-400 break-all">
                                                {connection.host.toString()}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-700 dark:text-gray-300">Receiver DID:</span>
                                            <p className="text-sm font-mono text-gray-600 dark:text-gray-400 break-all">
                                                {connection.receiver.toString()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            })
                        }
                    </Box>
                </DBConnect>
            </div>
        </>
    );
}