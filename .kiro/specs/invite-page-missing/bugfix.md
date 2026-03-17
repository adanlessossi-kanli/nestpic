# Bugfix Requirements Document

## Introduction

The NavBar component links to `/invite` in both desktop and mobile menus, but no page exists at that route. Navigating to `/invite` returns a 404. The fix is to create the missing page at `src/app/invite/page.tsx` that allows authenticated users to generate an invite link via the existing `POST /api/auth/invite` endpoint and display it for copying/sharing.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an authenticated user clicks the "Invite" link in the desktop NavBar THEN the system returns a 404 error page
1.2 WHEN an authenticated user clicks the "Invite" link in the mobile NavBar THEN the system returns a 404 error page
1.3 WHEN an authenticated user navigates directly to `/invite` THEN the system returns a 404 error page

### Expected Behavior (Correct)

2.1 WHEN an authenticated user clicks the "Invite" link in the desktop NavBar THEN the system SHALL render the invite page at `/invite`
2.2 WHEN an authenticated user clicks the "Invite" link in the mobile NavBar THEN the system SHALL render the invite page at `/invite`
2.3 WHEN an authenticated user navigates to `/invite` and requests an invite link THEN the system SHALL call `POST /api/auth/invite` and display the returned invite link for copying
2.4 WHEN an authenticated user has exceeded 5 invite requests per hour and attempts to generate another THEN the system SHALL display a rate limit error message without crashing

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an authenticated user navigates to `/feed` or `/albums` via the NavBar THEN the system SHALL CONTINUE TO render those pages correctly
3.2 WHEN an unauthenticated user visits `/invite` THEN the system SHALL CONTINUE TO redirect them to `/signin` per existing middleware auth rules
3.3 WHEN a user visits `/register/{token}` with a valid invite token THEN the system SHALL CONTINUE TO render the registration form correctly
3.4 WHEN `POST /api/auth/invite` is called directly THEN the system SHALL CONTINUE TO create an invitation token and return the invite link as before
