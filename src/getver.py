#!/usr/bin/env python3

import sys
import json
import time

# Open the manifest file and read its contents
with open('manifest.json', 'r') as fh:
    manifest_json = fh.read()

# Parse the JSON content
manifest = json.loads(manifest_json)

# Extract the version from the manifest
ver = manifest.get('version', '')

# Unstable build for testing
if 'pre' in ver or ver.endswith('+'):
    ver += '.' + time.strftime("%Y%m%d", time.localtime())

# Print the version
sys.stdout.write(ver)
