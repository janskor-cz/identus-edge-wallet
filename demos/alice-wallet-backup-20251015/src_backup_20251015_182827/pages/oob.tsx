import React from "react";
import { useMountedApp } from "@/reducers/store";
import { PageHeader } from "@/components/PageHeader";
import { FooterNavigation } from "@/components/FooterNavigation";
import { DBConnect } from "@/components/DBConnect";
import { OOB } from "@/components/OOB";
import '../app/index.css';

export default function OOBPage() {
    const app = useMountedApp();
    const agent = app.agent.instance;
    const pluto = app.db.instance;

    return (
        <>
            <div className="mx-4 mt-5 mb-32">
                <PageHeader>
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white text-center">
                        🔗 Out-of-Band Connections
                    </h1>
                    <p className="mb-6 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 xl:px-48 dark:text-gray-400 text-center">
                        Create and accept secure DIDComm connection invitations
                    </p>
                </PageHeader>

                <DBConnect>
                    {agent && pluto && (
                        <OOB agent={agent} pluto={pluto} />
                    )}
                </DBConnect>
            </div>
            <FooterNavigation />
        </>
    );
}