import { LogOut } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '../../api';
import type { User } from '../../types';

/**
 * Minimal settings surface (Phase 1). The route table requires `/settings`; this
 * view shows the signed-in account and a sign-out action. It intentionally adds
 * no new business logic — deeper preferences can land in a later phase.
 */
export function SettingsView({ me, onLogout }: { me: User; onLogout: () => void }) {
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => post('/api/auth/logout', {}),
    onSuccess: () => {
      qc.clear();
      onLogout();
    }
  });

  return (
    <div className="single-pane">
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>设置</h1>
      <p className="muted" style={{ marginTop: 0 }}>账户与登录信息。</p>

      <div className="home-card" style={{ marginTop: 16 }}>
        <div className="home-card-head"><span>账户</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
          <div className="rp-info-row"><span>姓名</span><b>{me.name}</b></div>
          <div className="rp-info-row"><span>邮箱</span><b>{me.email}</b></div>
          {me.isInstanceOwner && (
            <div className="rp-info-row"><span>角色</span><b>实例所有者</b></div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="ghost danger sm" disabled={logout.isPending} onClick={() => logout.mutate()}>
          <LogOut size={14} /> 退出登录
        </button>
      </div>
    </div>
  );
}
