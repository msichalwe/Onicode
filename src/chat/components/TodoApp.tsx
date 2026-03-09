import React, { useMemo, useState } from 'react';

type Todo = {
  id: number;
  text: string;
  done: boolean;
};

export default function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');

  const addTodo = () => {
    const text = input.trim();
    if (!text) return;

    setTodos((prev) => [...prev, { id: Date.now(), text, done: false }]);
    setInput('');
  };

  const toggleTodo = (id: number) => {
    setTodos((prev) =>
      prev.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))
    );
  };

  const removeTodo = (id: number) => {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  };

  const clearCompleted = () => {
    setTodos((prev) => prev.filter((todo) => !todo.done));
  };

  const remaining = useMemo(() => todos.filter((todo) => !todo.done).length, [todos]);

  return (
    <div style={{ padding: '24px', maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ marginTop: 0 }}>Todo List</h2>
      <p style={{ opacity: 0.8 }}>A simple todo app with add, complete, and delete.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTodo();
          }}
          placeholder="What do you need to do?"
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #8884',
            background: 'transparent',
            color: 'inherit'
          }}
        />
        <button onClick={addTodo}>Add</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <small>{remaining} remaining</small>
        <button onClick={clearCompleted} disabled={!todos.some((t) => t.done)}>
          Clear completed
        </button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {todos.map((todo) => (
          <li
            key={todo.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              border: '1px solid #8884',
              borderRadius: 10,
              padding: '10px 12px'
            }}
          >
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggleTodo(todo.id)}
            />
            <span style={{ flex: 1, textDecoration: todo.done ? 'line-through' : 'none', opacity: todo.done ? 0.6 : 1 }}>
              {todo.text}
            </span>
            <button onClick={() => removeTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && <p style={{ opacity: 0.7, marginTop: 16 }}>No tasks yet. Add your first todo above.</p>}
    </div>
  );
}
