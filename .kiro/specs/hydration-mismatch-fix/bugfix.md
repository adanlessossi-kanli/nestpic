# Bugfix Requirements Document

## Introduction

The Next.js 14 App Router app produces a React hydration mismatch warning on every page load. The `body` element's `className` differs between the server-rendered HTML and the client-side hydration pass because a third-party browser extension (e.g. a text highlighter) injects an extra class (`highlighter-context`) into the DOM after the server renders it. React detects this discrepancy and logs a warning, which can mask real hydration errors and degrade developer experience.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the page is loaded in a browser that has a class-injecting extension active THEN the system logs `Warning: Prop 'className' did not match. Server: "min-h-screen bg-gray-50 highlighter-context" Client: "min-h-screen bg-gray-50"` in the browser console

1.2 WHEN React hydrates the `body` element in `RootLayout` THEN the system detects a className mismatch between the server-rendered HTML and the client DOM, causing a hydration error

### Expected Behavior (Correct)

2.1 WHEN the page is loaded in a browser that has a class-injecting extension active THEN the system SHALL hydrate without logging a className mismatch warning for the `body` element

2.2 WHEN React hydrates the `body` element in `RootLayout` THEN the system SHALL suppress hydration warnings caused by third-party DOM mutations on that element

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the page is loaded in a browser without any class-injecting extension THEN the system SHALL CONTINUE TO render the `body` element with the correct Tailwind classes (`min-h-screen bg-gray-50`)

3.2 WHEN any page route is rendered THEN the system SHALL CONTINUE TO display the navigation bar and main content correctly

3.3 WHEN an auth route (`/signin`, `/register`) is rendered THEN the system SHALL CONTINUE TO hide the navigation bar as expected
