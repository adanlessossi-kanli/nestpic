import { query } from '@/lib/db';
import RegisterForm from './RegisterForm';

interface PageProps {
  params: Promise<{ token: string }>;
}

type InvitationRow = {
  id: string;
  expires_at: string;
  used_at: string | null;
};

async function getInvitationStatus(token: string): Promise<'valid' | 'expired_or_used' | 'not_found'> {
  // Basic UUID format check before hitting the DB
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return 'not_found';
  }

  const result = await query<InvitationRow>(
    'SELECT id, expires_at, used_at FROM invitations WHERE id = $1',
    [token]
  );

  if (result.rows.length === 0) {
    return 'not_found';
  }

  const invitation = result.rows[0];
  const isExpired = new Date(invitation.expires_at) <= new Date();
  const isUsed = invitation.used_at !== null;

  if (isExpired || isUsed) {
    return 'expired_or_used';
  }

  return 'valid';
}

export default async function RegisterPage({ params }: PageProps) {
  const { token } = await params;
  const status = await getInvitationStatus(token);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Nestpic</h1>
          <p className="mt-2 text-sm text-gray-500">
            {status === 'valid' ? 'Create your account' : 'Invitation invalid'}
          </p>
        </div>

        {status === 'expired_or_used' && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 border border-red-200 px-6 py-5 text-sm text-red-700 text-center"
          >
            <p className="font-medium mb-1">Invitation expired or already used</p>
            <p className="text-red-600">
              This invitation link is no longer valid. Please ask a family member to send you a new
              invitation.
            </p>
          </div>
        )}

        {status === 'not_found' && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 border border-red-200 px-6 py-5 text-sm text-red-700 text-center"
          >
            <p className="font-medium mb-1">Invalid invitation</p>
            <p className="text-red-600">
              This invitation link is not valid. Please check the link and try again.
            </p>
          </div>
        )}

        {status === 'valid' && <RegisterForm token={token} />}
      </div>
    </div>
  );
}
