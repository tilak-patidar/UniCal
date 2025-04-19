# SmartCalendr - Unified Calendar

SmartCalendr is a modern web application that allows users to connect and view their Google and Microsoft calendars in one unified interface.

## Features

- User authentication with NextAuth.js
- Integration with Google Calendar and Microsoft Outlook Calendar
- Unified calendar view showing events from both providers
- Modern UI with Tailwind CSS
- Responsive design

## Technologies Used

- Next.js 15 with App Router
- TypeScript
- NextAuth.js for authentication
- React Big Calendar for the calendar interface
- Tailwind CSS for styling
- Headless UI for accessible components
- Heroicons for icons

## Setup and Configuration

### Prerequisites

- Node.js 18.0.0 or later

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/smartcalendr.git
   cd smartcalendr
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env.local` file in the root directory with the following content:

   ```
   # Auth
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=your-nextauth-secret

   # Google OAuth
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret

   # Microsoft OAuth
   AZURE_AD_CLIENT_ID=your-azure-ad-client-id
   AZURE_AD_CLIENT_SECRET=your-azure-ad-client-secret
   AZURE_AD_TENANT_ID=your-azure-ad-tenant-id
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Setting Up OAuth Providers

#### Google OAuth

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Go to APIs & Services > Credentials
4. Create an OAuth client ID
5. Set the authorized redirect URI to `http://localhost:3000/api/auth/callback/google`
6. Copy the client ID and client secret to your `.env.local` file

#### Microsoft OAuth

1. Go to the [Azure Portal](https://portal.azure.com/)
2. Register a new application in Azure Active Directory
3. Add the following redirect URI: `http://localhost:3000/api/auth/callback/azure-ad`
4. Create a client secret
5. Make sure to grant permission for Microsoft Graph API with Calendar.Read scope
6. Copy the client ID, client secret, and tenant ID to your `.env.local` file

## Development

### Running the Development Server

```bash
npm run dev
```

### Building for Production

```bash
npm run build
npm start
```

## License

This project is licensed under the MIT License.

## Acknowledgements

- Next.js team for the amazing framework
- Vercel for hosting and deployment
- All the open-source libraries used in this project
