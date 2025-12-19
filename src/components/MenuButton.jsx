// src/components/MenuButton.jsx
import React from 'react';

const MenuIconSrc = '/icons/free-icon-main-menu.png';

const MenuButton = ({ onClick }) => {
  return (
    <button className="menu-button" onClick={onClick}>
      {/* Иконка */}
      <img src={MenuIconSrc} alt="Открыть меню" className="menu-icon" />
      {/* Текст */}
      <span className="menu-text">Открыть меню</span>
    </button>
  );
};

export default MenuButton;