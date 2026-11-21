import React from 'react';
import { Button } from 'react-bootstrap';
import { useAuth } from '../../auth/AuthContext';

// Keep permission decisions next to each action; backend remains authoritative.
export default function PermissionButton({ permKey, method, native = false, disabled, ...props }) {
  const { can } = useAuth();
  const blocked = !can(permKey, method);
  const Component = native ? 'button' : Button;
  return <Component {...props} disabled={disabled || blocked}
    title={blocked ? 'You do not have permission to perform this operation' : props.title} />;
}
