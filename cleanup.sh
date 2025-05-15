#!/bin/bash

# Cleanup script for outdated Raydium CLMM files

echo "Cleaning up outdated Raydium CLMM files..."

# Remove the old IDL file
if [ -f "src/services/raydiumClmmIdl.js" ]; then
  echo "Removing src/services/raydiumClmmIdl.js"
  rm src/services/raydiumClmmIdl.js
fi

# Remove the old JS implementation
if [ -f "src/services/raydiumIdl.js" ]; then
  echo "Removing src/services/raydiumIdl.js"
  rm src/services/raydiumIdl.js
fi

# We're keeping raydiumClmmService.ts as a backup for reference but renaming it
if [ -f "src/services/raydiumClmmService.ts" ]; then
  echo "Renaming src/services/raydiumClmmService.ts to src/services/raydiumClmmService.ts.bak"
  mv src/services/raydiumClmmService.ts src/services/raydiumClmmService.ts.bak
fi

echo "Cleanup complete!" 