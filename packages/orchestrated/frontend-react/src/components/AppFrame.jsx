import React, { useMemo } from 'react';
import Button from './Button';

const AppFrame = ({
  children,
  currentView,
  gotoCustomersView,
  gotoOrdersView,
  gotoOrderConfirmationRequestsView,
  gotoAboutView,
}) => {
  const navigationTargets = useMemo(
    () => ({
      customers: {
        text: 'Customers',
        clickHandler: gotoCustomersView,
      },
      orders: {
        text: 'Orders',
        clickHandler: gotoOrdersView,
      },
      orderConfirmationRequests: {
        text: 'Order Confirmation Requests',
        clickHandler: gotoOrderConfirmationRequestsView,
      },
      about: {
        text: 'About',
        clickHandler: gotoAboutView,
      },
    }),
    [
      gotoAboutView,
      gotoCustomersView,
      gotoOrderConfirmationRequestsView,
      gotoOrdersView,
    ],
  );

  return (
    <>
      <div className="bg-orange-100 p-2 rounded flex items-center">
        {Object.entries(navigationTargets).map(
          ([key, { text, clickHandler }]) => (
            <Button
              key={key}
              kind={currentView === key ? 'toolbar-selected' : 'toolbar'}
              onClick={clickHandler}
              text={text}
            />
          ),
        )}
        <a
          href="http://admin.localhost"
          target="_blank"
          rel="noopener noreferrer"
          className="select-none inline-block cursor-pointer bg-orange-400 hover:bg-amber-300 py-1 px-2 mx-1 rounded"
        >Admin ↗</a>
        <div className="ml-auto font-bold">React Frontend</div>
      </div>

      {children}
    </>
  );
};

export default React.memo(AppFrame);
