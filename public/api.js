const API_URL = 'http://localhost:5000/api';

async function fetchPlans() {
  try {
    const response = await fetch(`${API_URL}/plans`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching plans:', error);
    return [];
  }
}

async function registerUser(userData) {
  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    return await response.json();
  } catch (error) {
    console.error('Error registering user:', error);
    return { error: 'Registration failed' };
  }
}

async function submitContact(contactData) {
  try {
    const response = await fetch(`${API_URL}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactData)
    });
    return await response.json();
  } catch (error) {
    console.error('Error submitting contact form:', error);
    return { error: 'Submission failed' };
  }
}
