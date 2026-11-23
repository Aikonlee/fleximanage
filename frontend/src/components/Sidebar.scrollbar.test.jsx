import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar, {
  MIN_THUMB_HEIGHT_PX,
  computeScrollbarMetrics,
  computeScrollTopForDrag,
  computeScrollTopForTrackClick
} from './Sidebar';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    perms: null,
    isAdmin: true,
    orgName: 'Test Org'
  })
}));

vi.mock('../auth/permissions', () => ({
  hasViewPermission: () => true
}));

function setScrollGeometry(element, { scrollTop = 0, scrollHeight = 500, clientHeight = 500 }) {
  let currentScrollTop = scrollTop;
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => clientHeight
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => currentScrollTop,
    set: (value) => {
      currentScrollTop = value;
    }
  });
  return {
    getScrollTop: () => currentScrollTop,
    setDimensions: (next) => {
      if (next.scrollTop !== undefined) currentScrollTop = next.scrollTop;
      if (next.scrollHeight !== undefined) scrollHeight = next.scrollHeight;
      if (next.clientHeight !== undefined) clientHeight = next.clientHeight;
    }
  };
}

describe('computeScrollbarMetrics', () => {
  test('disables thumb when content fits or dimensions are invalid', () => {
    expect(computeScrollbarMetrics({ scrollTop: 0, scrollHeight: 500, clientHeight: 500 })).toEqual({
      scrollable: false,
      scrollRatio: 0,
      thumbHeightRatio: 1,
      thumbHeightPx: 0,
      thumbTopPx: 0
    });

    expect(computeScrollbarMetrics({ scrollTop: 10, scrollHeight: 300, clientHeight: 500 }).scrollable).toBe(false);
    expect(computeScrollbarMetrics({ scrollTop: 0, scrollHeight: 500, clientHeight: 0 }).scrollable).toBe(false);
  });

  test('computes proportional thumb height and position across top, middle, and bottom', () => {
    const top = computeScrollbarMetrics({
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 500
    });
    expect(top).toEqual({
      scrollable: true,
      scrollRatio: 0,
      thumbHeightRatio: 0.5,
      thumbHeightPx: 250,
      thumbTopPx: 0
    });

    const middle = computeScrollbarMetrics({
      scrollTop: 250,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 500
    });
    expect(middle.scrollRatio).toBe(0.5);
    expect(middle.thumbTopPx).toBe(125);

    const bottom = computeScrollbarMetrics({
      scrollTop: 500,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 500
    });
    expect(bottom.scrollRatio).toBe(1);
    expect(bottom.thumbTopPx).toBe(250);
  });

  test('clamps out-of-range scrollTop to [0, 1] and enforces minimum thumb height', () => {
    const underflow = computeScrollbarMetrics({
      scrollTop: -50,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 500
    });
    expect(underflow.scrollRatio).toBe(0);
    expect(underflow.thumbTopPx).toBe(0);

    const overflow = computeScrollbarMetrics({
      scrollTop: 9999,
      scrollHeight: 1000,
      clientHeight: 500,
      trackHeight: 500
    });
    expect(overflow.scrollRatio).toBe(1);
    expect(overflow.thumbTopPx).toBe(250);

    const veryTall = computeScrollbarMetrics({
      scrollTop: 9500,
      scrollHeight: 10000,
      clientHeight: 500,
      trackHeight: 500
    });
    expect(veryTall.thumbHeightRatio).toBeCloseTo(0.05);
    expect(veryTall.thumbHeightPx).toBe(MIN_THUMB_HEIGHT_PX);
    expect(veryTall.thumbTopPx).toBe(500 - MIN_THUMB_HEIGHT_PX);
  });
});

describe('computeScrollTopForDrag and computeScrollTopForTrackClick', () => {
  test('maps drag delta proportionally and clamps within bounds', () => {
    expect(computeScrollTopForDrag({
      startScrollTop: 0,
      deltaY: 125,
      trackHeight: 500,
      thumbHeightPx: 250,
      scrollHeight: 1000,
      clientHeight: 500
    })).toBe(250);

    expect(computeScrollTopForDrag({
      startScrollTop: 400,
      deltaY: 300,
      trackHeight: 500,
      thumbHeightPx: 250,
      scrollHeight: 1000,
      clientHeight: 500
    })).toBe(500);

    expect(computeScrollTopForDrag({
      startScrollTop: 100,
      deltaY: -300,
      trackHeight: 500,
      thumbHeightPx: 250,
      scrollHeight: 1000,
      clientHeight: 500
    })).toBe(0);
  });

  test('maps track click offset to top, middle, and bottom scroll positions', () => {
    const base = {
      trackHeight: 500,
      thumbHeightPx: 250,
      scrollHeight: 1000,
      clientHeight: 500
    };
    expect(computeScrollTopForTrackClick({ ...base, clickOffsetY: 0 })).toBe(0);
    expect(computeScrollTopForTrackClick({ ...base, clickOffsetY: 250 })).toBe(250);
    expect(computeScrollTopForTrackClick({ ...base, clickOffsetY: 500 })).toBe(500);
  });
});

describe('Sidebar custom left-edge scrollbar integration', () => {
  test('hides thumb when content fits, shows and updates thumb on scroll, resize, drag, and track click', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>
    );

    const sidebarEl = container.querySelector('.sidebar');
    const trackEl = screen.getByTestId('sidebar-scrollbar-track');

    // Initially no overflow in jsdom -> track is present, thumb is hidden
    expect(trackEl).toHaveAttribute('data-scrollable', 'false');
    expect(screen.queryByTestId('sidebar-scrollbar-thumb')).not.toBeInTheDocument();

    // Simulate overflowing sidebar
    const geo = setScrollGeometry(sidebarEl, {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 500
    });
    Object.defineProperty(trackEl, 'clientHeight', {
      configurable: true,
      get: () => 500
    });
    trackEl.getBoundingClientRect = () => ({
      top: 60,
      bottom: 560,
      left: 0,
      right: 12,
      width: 12,
      height: 500
    });

    // Window resize triggers recomputation
    fireEvent(window, new Event('resize'));

    const thumbEl = screen.getByTestId('sidebar-scrollbar-thumb');
    expect(trackEl).toHaveAttribute('data-scrollable', 'true');
    expect(thumbEl.style.height).toBe('250px');
    expect(thumbEl.style.top).toBe('0px');

    // Scroll event updates thumb position
    geo.setDimensions({ scrollTop: 250 });
    fireEvent.scroll(sidebarEl);
    expect(thumbEl.style.top).toBe('125px');

    // Dragging thumb scrolls sidebar proportionally and cleans up on pointerup
    fireEvent.pointerDown(thumbEl, { button: 0, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 325, pointerId: 1 });
    expect(geo.getScrollTop()).toBe(500);
    expect(thumbEl.style.top).toBe('250px');

    fireEvent.pointerUp(window, { pointerId: 1 });
    // Further pointer moves after release do not scroll
    fireEvent.pointerMove(window, { clientY: 100, pointerId: 1 });
    expect(geo.getScrollTop()).toBe(500);

    // Clicking top of track jumps to top
    fireEvent.pointerDown(trackEl, { button: 0, clientY: 60, pointerId: 2 });
    expect(geo.getScrollTop()).toBe(0);
    expect(thumbEl.style.top).toBe('0px');
    fireEvent.pointerUp(window, { pointerId: 2 });

    // Expanding a menu group still works without interference
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    expect(screen.getByText('Devices')).toBeInTheDocument();

    // Shrinking content below viewport hides thumb again
    geo.setDimensions({ scrollHeight: 400, clientHeight: 500, scrollTop: 0 });
    fireEvent(window, new Event('resize'));
    expect(trackEl).toHaveAttribute('data-scrollable', 'false');
    expect(screen.queryByTestId('sidebar-scrollbar-thumb')).not.toBeInTheDocument();
  });
});
