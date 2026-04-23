import { Component } from '@angular/core';
import { PhoneOtpFormComponent } from './phone-otp-form.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [PhoneOtpFormComponent],
  template: `<app-phone-otp-form mode="register" />`,
})
export class RegisterComponent {}
