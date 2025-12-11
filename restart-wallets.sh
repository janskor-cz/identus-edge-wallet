#!/bin/bash
echo "Killing all Next.js processes..."
pkill -9 -f "next dev"
sleep 2

echo "Starting Alice wallet..."
cd /root/clean-identus-wallet/sdk-v6-test/sdk-ts/demos/alice-wallet
rm -rf .next
yarn dev > /tmp/alice-sdk-label.log 2>&1 &
ALICE_PID=$!

echo "Starting Bob wallet..."
cd /root/clean-identus-wallet/sdk-v6-test/sdk-ts/demos/bob-wallet
rm -rf .next
yarn dev > /tmp/bob-sdk-label.log 2>&1 &
BOB_PID=$!

echo "Alice PID: $ALICE_PID"
echo "Bob PID: $BOB_PID"
echo "Wallets started. Waiting 15 seconds..."
sleep 15

echo ""
echo "=== Alice Wallet Log ===" 
tail -30 /tmp/alice-sdk-label.log

echo ""
echo "=== Bob Wallet Log ===" 
tail -30 /tmp/bob-sdk-label.log
