import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '5s', target: 50 },  
        { duration: '10s', target: 50 }, 
        { duration: '5s', target: 0 },   
    ],
};

export default function () {
    const url = 'http://localhost:3000/TPiluFO'; 

    const res = http.get(url, { redirects: 0 });

    check(res, {
        'status is 302': (r) => r.status === 302,
        'transaction time OK': (r) => r.timings.duration < 5, 
    });

    sleep(0.1);
}