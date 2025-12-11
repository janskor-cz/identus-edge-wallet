import React, { useEffect, useState } from "react";
import SDK from "@hyperledger/identus-edge-agent-sdk";
import { Box } from "../app/Box";
import '../app/index.css'
import { DBConnect } from "@/components/DBConnect";
import { useMountedApp } from "@/reducers/store";
import { Message } from "@/components/Message";
import { PageHeader } from "@/components/PageHeader";

const ListenerKey = SDK.ListenerKey;
const Agent: React.FC<{}> = props => {
  // 🔍 DEBUG: Log component mount
  console.log('🚀 [index.tsx] Agent component mounting/rendering');

  const app = useMountedApp();
  const { db, mediatorDID, initAgent, startAgent } = app;

  const agent = app.agent.instance;

  console.log('🔍 [index.tsx] Component state:', {
    'db.connected': db.connected,
    'db.instance': !!db.instance,
    'agent.instance': !!agent,
    'agent.hasStarted': app.agent.hasStarted,
    'agent.isStarting': app.agent.isStarting
  });

  const [state, setState] = useState<string>(agent && agent.state !== undefined ? agent.state : "loading");
  const [error] = React.useState<any>();

  const [messages, setNewMessage] = React.useState<SDK.Domain.Message[]>([]);

  const handleMessages = async (
    newMessages: SDK.Domain.Message[]
  ) => {
    setNewMessage([
      ...newMessages,
      ...messages,
    ])
  };

  useEffect(() => {
    setNewMessage([
      ...messages
        .filter(({ id }) => app.messages.find((appMessage) => appMessage.id === id) !== undefined)
        .map(({ id }) => app.messages.find((appMessage) => appMessage.id === id)!)
    ])
  }, [app.messages]);

  useEffect(() => {
    if (!app.agent.instance && db.instance) {
      console.log('🔄 [index.tsx] Database connected, initializing agent...');
      initAgent({ mediatorDID, pluto: db.instance, defaultSeed: app.defaultSeed })
    }
    if (app.agent && app.agent.instance) {
      setState(app.agent.instance.state)
    }
  }, [app.agent, db]);

  // Separate useEffect for starting agent - runs when agent state changes
  useEffect(() => {
    console.log('🔍 [index.tsx] Auto-start useEffect triggered:', {
      hasInstance: !!app.agent.instance,
      hasStarted: app.agent.hasStarted,
      isStarting: app.agent.isStarting,
      agentState: app.agent.instance?.state
    });

    if (app.agent.instance && !app.agent.hasStarted && !app.agent.isStarting) {
      console.log('🚀 [index.tsx] Conditions met - starting agent automatically...');

      startAgent({ agent: app.agent.instance })
        .then(() => {
          console.log('✅ [index.tsx] startAgent action completed successfully');
        })
        .catch((error) => {
          console.error('❌ [index.tsx] startAgent action failed:', error);
        });
    } else {
      console.log('⏸️ [index.tsx] Auto-start skipped - conditions not met');
    }
  }, [app.agent.instance, app.agent.hasStarted, app.agent.isStarting]); // Watch all relevant flags

  useEffect(() => {
    if (agent) {
      agent.addListener(ListenerKey.MESSAGE, handleMessages);
    }
    return () => {
      if (agent) {
        agent.removeListener(ListenerKey.MESSAGE, handleMessages);
      }
    }
  }, [agent])

  return (
    <>
      <div className="mx-10 mt-5 mb-30">
        <PageHeader>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
            Edge Agent
          </h1>
        </PageHeader>
        <DBConnect>
          <Box>
            <div>
              {state === "running" && (
                <>

                  {messages.length > 0 ? messages.reverse().map((message, i) => {
                    return <Message message={message} key={`index_message${message.id}_${i}`} />
                  }) : <>Listening for new messages</>}
                </>
              )}
              {state !== "running" && <>Start the agent first</>}
            </div>
            {error instanceof Error && (
              <pre>
                Error: {error.message}
              </pre>
            )}
          </Box>
        </DBConnect>
      </div>
    </>

  );
};



export default Agent
